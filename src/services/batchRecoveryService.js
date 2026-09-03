const { AppError } = require('../utils/AppError');
const { RecoveryRecommendationService } = require('../services/recoveryRecommendationService');
const { RecoveryExecutionService } = require('../services/recoveryExecutionService');
const { ReadRepository } = require('../repositories/readRepository');
const { OPEN_RECOVERY_CASE_STATUSES, PAYMENT_STATUS } = require('../constants/enums');

const DEFAULT_BATCH_LIMIT = 20;
const MAX_BATCH_LIMIT = 50;

class BatchRecoveryService {
  constructor({
    recommendationService = new RecoveryRecommendationService(),
    executionService = new RecoveryExecutionService(),
    repository = new ReadRepository()
  } = {}) {
    this.recommendationService = recommendationService;
    this.executionService = executionService;
    this.repository = repository;
  }

  async runBatch({ merchantId, limit = DEFAULT_BATCH_LIMIT }) {
    const boundedLimit = Math.min(Math.max(1, limit), MAX_BATCH_LIMIT);

    const { items: cases } = await this.repository.listRecoveryCases(merchantId, {
      status: 'OPEN',
      page: 1,
      limit: boundedLimit
    });

    const atRisk = cases.length;
    let processed = 0;
    let recommended = 0;
    let policyAllowed = 0;
    let policyBlocked = 0;
    let escalated = 0;
    let executionPending = 0;
    let confirmedRecoveries = 0;
    let executionFailed = 0;
    let skipped = 0;

    const results = [];

    for (const recoveryCase of cases) {
      processed += 1;

      try {
        const recommendationResult = await this.recommendationService.generateRecommendation({
          merchantId,
          recoveryCaseId: recoveryCase._id
        });

        if (recommendationResult.notActionable || recommendationResult.duplicate) {
          skipped += 1;
          results.push({
            caseId: String(recoveryCase._id),
            status: 'skipped',
            reason: recommendationResult.reason || 'Not actionable or duplicate'
          });
          continue;
        }

        recommended += 1;

        if (recommendationResult.escalated) {
          escalated += 1;
          policyBlocked += 1;
          results.push({
            caseId: String(recoveryCase._id),
            status: 'escalated',
            recommendation: recommendationResult.recommendation?.action,
            policyDecision: 'BLOCKED',
            stoppingRule: recommendationResult.stoppingRule,
            reason: recommendationResult.policyDecision?.reason
          });
          continue;
        }

        if (recommendationResult.policyDecision?.decision !== 'ALLOWED') {
          policyBlocked += 1;
          results.push({
            caseId: String(recoveryCase._id),
            status: 'blocked',
            recommendation: recommendationResult.recommendation?.action,
            policyDecision: 'BLOCKED',
            reason: recommendationResult.policyDecision?.reason
          });
          continue;
        }

        policyAllowed += 1;

        const actionId = recommendationResult.recoveryAction?.id;
        if (!actionId) {
          skipped += 1;
          results.push({
            caseId: String(recoveryCase._id),
            status: 'skipped',
            reason: 'No executable action produced'
          });
          continue;
        }

        const executionResult = await this.executionService.execute({
          merchantId,
          actionId
        });

        if (executionResult.outcome === 'EXECUTED') {
          executionPending += 1;
          results.push({
            caseId: String(recoveryCase._id),
            status: 'pending',
            recommendation: recommendationResult.recommendation?.action,
            policyDecision: 'ALLOWED',
            paymentLink: executionResult.paymentLink?.shortUrl
          });
        } else if (executionResult.outcome === 'RECOVERED') {
          confirmedRecoveries += 1;
          results.push({
            caseId: String(recoveryCase._id),
            status: 'recovered',
            recommendation: recommendationResult.recommendation?.action,
            policyDecision: 'ALLOWED',
            recoveredAmount: executionResult.paymentLink?.amountPaid
          });
        } else {
          executionFailed += 1;
          results.push({
            caseId: String(recoveryCase._id),
            status: executionResult.outcome === 'BLOCKED' ? 'blocked' : 'failed',
            recommendation: recommendationResult.recommendation?.action,
            policyDecision: executionResult.outcome === 'BLOCKED' ? 'BLOCKED' : 'ALLOWED',
            reason: executionResult.reason
          });
        }
      } catch (error) {
        skipped += 1;
        results.push({
          caseId: String(recoveryCase._id),
          status: 'error',
          reason: error.message
        });
      }
    }

    return {
      summary: {
        atRisk,
        processed,
        recommended,
        policyAllowed,
        policyBlocked,
        escalated,
        executionPending,
        confirmedRecoveries,
        executionFailed,
        skipped
      },
      results
    };
  }
}

module.exports = { BatchRecoveryService, DEFAULT_BATCH_LIMIT, MAX_BATCH_LIMIT };
