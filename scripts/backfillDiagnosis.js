const mongoose = require('mongoose');
const { connectDatabase } = require('../src/config/database');
const RecoveryCase = require('../src/models/RecoveryCase');
const Payment = require('../src/models/Payment');
const AuditEvent = require('../src/models/AuditEvent');
const { classifyFailure } = require('../src/services/recoveryIntelligenceService');
const { AUDIT_EVENT_TYPE, ACTOR_TYPE } = require('../src/constants/enums');

async function backfillDiagnosis() {
  await connectDatabase();
  
  const cases = await RecoveryCase.find({}).lean();
  console.log(`Total recovery cases: ${cases.length}`);
  
  let alreadyHasDiagnosis = 0;
  let missingDiagnosis = 0;
  let backfilled = 0;
  let skippedNoAudit = 0;
  let skippedNoMetadata = 0;
  
  for (const recoveryCase of cases) {
    if (recoveryCase.diagnosis && recoveryCase.diagnosis.explanation) {
      alreadyHasDiagnosis++;
      continue;
    }
    
    missingDiagnosis++;
    
    const payment = await Payment.findById(recoveryCase.payment).lean();
    if (!payment) {
      console.log(`  Skipping ${recoveryCase._id}: payment not found`);
      skippedNoAudit++;
      continue;
    }
    
    const recommendedEvent = await AuditEvent.findOne({
      recoveryCase: recoveryCase._id,
      type: AUDIT_EVENT_TYPE.ACTION_RECOMMENDED
    }).sort({ createdAt: -1 }).lean();
    
    if (!recommendedEvent) {
      skippedNoAudit++;
      continue;
    }
    
    const metadata = recommendedEvent.metadata || {};
    const diagnosisExplanation = metadata.diagnosis;
    
    if (!diagnosisExplanation) {
      skippedNoMetadata++;
      continue;
    }
    
    const category = classifyFailure(payment.failure?.code);
    const confidence = typeof metadata.confidence === 'number' ? metadata.confidence : undefined;
    
    await RecoveryCase.updateOne(
      { _id: recoveryCase._id },
      {
        diagnosis: {
          category,
          explanation: diagnosisExplanation,
          confidence
        }
      }
    );
    
    const existingDiagnosisEvent = await AuditEvent.findOne({
      recoveryCase: recoveryCase._id,
      type: AUDIT_EVENT_TYPE.AI_DIAGNOSIS_RECORDED
    }).lean();
    
    if (!existingDiagnosisEvent) {
      await AuditEvent.create({
        merchant: recoveryCase.merchant,
        payment: recoveryCase.payment,
        recoveryCase: recoveryCase._id,
        providerEventId: `recoverai:diagnosis:${recoveryCase._id}`,
        type: AUDIT_EVENT_TYPE.AI_DIAGNOSIS_RECORDED,
        actor: ACTOR_TYPE.SYSTEM,
        reason: 'Diagnosis recorded from AI/fallback recommendation.',
        result: 'DIAGNOSED'
      });
    }
    
    backfilled++;
    console.log(`  Backfilled ${recoveryCase._id}: category=${category}, confidence=${confidence}`);
  }
  
  console.log('\n=== BACKFILL SUMMARY ===');
  console.log(`Total cases: ${cases.length}`);
  console.log(`Already had diagnosis: ${alreadyHasDiagnosis}`);
  console.log(`Missing diagnosis: ${missingDiagnosis}`);
  console.log(`Backfilled: ${backfilled}`);
  console.log(`Skipped (no audit event): ${skippedNoAudit}`);
  console.log(`Skipped (no diagnosis in metadata): ${skippedNoMetadata}`);
  
  await mongoose.disconnect();
}

backfillDiagnosis().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
