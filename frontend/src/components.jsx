import { AlertTriangle, ArrowUpRight, Bot, Check, ChevronRight, CircleDollarSign, Clock3, Gauge, LockKeyhole, ShieldCheck, Sparkles, X, Zap } from 'lucide-react';
import { currency, label } from './utils';

export function Logo() {
  return <div className="brand"><span className="brand-mark"><span /></span><span>Recover<span className="brand-accent">AI</span></span></div>;
}

export function StatusBadge({ value, tone }) {
  const derived = tone || (['CAPTURED', 'RECOVERED', 'EXECUTED', 'POLICY_ALLOWED', 'ALLOWED'].includes(value) ? 'success' : ['FAILED', 'POLICY_BLOCKED', 'BLOCKED', 'UNRECOVERED'].includes(value) ? 'danger' : 'warning');
  return <span className={`status-badge ${derived}`}>{label(value)}</span>;
}

export function MetricCard({ icon: Icon = Gauge, label: title, value, detail, tone = 'blue' }) {
  return <article className={`metric-card ${tone}`}><div className="metric-top"><span className="icon-box"><Icon size={17} /></span><span className="metric-label">{title}</span></div><strong>{value}</strong>{detail && <span className="metric-detail">{detail}</span>}</article>;
}

export function PageHeader({ eyebrow, title, description, action }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

export function LoadingState({ text = 'Loading your recovery workspace' }) { return <div className="state-panel"><div className="spinner" /><span>{text}</span></div>; }
export function EmptyState({ icon: Icon = CircleDollarSign, title, text }) { return <div className="state-panel empty"><span className="empty-icon"><Icon size={22} /></span><strong>{title}</strong><span>{text}</span></div>; }
export function ErrorState({ message = 'We could not load this view.' }) { return <div className="state-panel error"><AlertTriangle size={22} /><strong>{message}</strong><span>Check the backend connection and try again.</span></div>; }

export function SectionHeading({ eyebrow, title, action }) { return <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action}</div>; }

export function Pipeline() {
  const stages = [
    ['DETECT', 'Failed payment identified', CircleDollarSign], ['DIAGNOSE', 'Failure reason understood', Bot], ['DECIDE', 'Recovery path selected', Sparkles], ['GATE', 'Policy makes the call', ShieldCheck], ['ACT', 'Bounded action executed', Zap], ['MEASURE', 'Evidence becomes value', Gauge]
  ];
  return <div className="pipeline">{stages.map(([name, text, Icon], index) => <div className="pipeline-stage" key={name}><div className="pipeline-icon"><Icon size={18} /></div><div><strong>{name}</strong><span>{text}</span></div>{index < stages.length - 1 && <ChevronRight className="pipeline-arrow" size={16} />}</div>)}</div>;
}

export function MiniBars({ title, subtitle, data = {}, emptyText = 'No events recorded yet.' }) {
  const entries = Object.entries(data); const max = Math.max(...entries.map(([, value]) => value), 1);
  return <div className="chart-panel"><div className="chart-title"><div><strong>{title}</strong><span>{subtitle}</span></div><ArrowUpRight size={16} /></div>{entries.length ? <div className="bar-list">{entries.map(([key, value]) => <div className="bar-row" key={key}><div className="bar-meta"><span>{label(key)}</span><b>{value}</b></div><div className="bar-track"><span style={{ width: `${Math.max(5, value / max * 100)}%` }} /></div></div>)}</div> : <div className="chart-empty">{emptyText}</div>}</div>;
}

export function EvidenceNote({ children }) { return <div className="evidence-note"><LockKeyhole size={15} /><span>{children}</span></div>; }

export function EvidenceTimeline({ case: recoveryCase, actions = [], auditEvents = [] }) {
  const events = [...auditEvents].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const primaryAction = actions.find((a) => a.type === 'CUSTOMER_REMINDER' || a.type === 'RETRY_PAYMENT' || a.type === 'PAYMENT_METHOD_UPDATE' || a.type === 'ESCALATE_TO_HUMAN');
  const hasPaymentFailed = Boolean(recoveryCase.payment?.failure?.code) || events.some((e) => e.type === 'PAYMENT_FAILED');
  const hasRecommendation = events.some((e) => e.type === 'AI_RECOMMENDATION_GENERATED' || e.type === 'ACTION_RECOMMENDED');
  const hasPolicyDecision = events.some((e) => e.type === 'POLICY_EVALUATED');
  const actionExecuted = primaryAction?.status === 'EXECUTED';
  const hasPaymentLink = primaryAction?.paymentLink?.id || primaryAction?.execution?.providerReference;
  const hasWebhook = events.some((e) => e.type === 'RECOVERY_COMPLETED' && e.actor === 'RAZORPAY');
  const isRecovered = recoveryCase.status === 'RECOVERED';
  const isEscalated = primaryAction?.type === 'ESCALATE_TO_HUMAN' || primaryAction?.policyDecision?.escalate;

  const stages = [];

  stages.push({ key: 'failed', label: 'Payment failed', state: hasPaymentFailed ? 'completed' : 'pending', detail: recoveryCase.payment?.failure?.code || (hasPaymentFailed ? 'Failure recorded' : undefined) });
  if (hasRecommendation) {
    const actionType = primaryAction?.type || 'UNKNOWN';
    stages.push({ key: 'recommendation', label: `AI recommended ${label(actionType)}`, state: 'completed', detail: primaryAction?.recommendation?.rationale });
  }
  if (hasPolicyDecision) {
    const decision = primaryAction?.policyDecision?.decision || 'UNKNOWN';
    const reason = primaryAction?.policyDecision?.reason;
    stages.push({ key: 'policy', label: `Policy ${label(decision)}`, state: decision === 'ALLOWED' ? 'completed' : 'blocked', detail: reason });
  }
  if (isEscalated && !actionExecuted) {
    stages.push({ key: 'escalation', label: 'Escalated to human review', state: 'blocked', detail: primaryAction?.policyDecision?.reason });
  }
  if (actionExecuted) {
    stages.push({ key: 'executed', label: 'Action executed', state: 'completed', detail: primaryAction?.execution?.providerReference });
  }
  if (hasPaymentLink && !isRecovered) {
    stages.push({ key: 'link', label: 'Payment link created', state: 'pending', detail: primaryAction?.paymentLink?.id || primaryAction?.execution?.providerReference });
  }
  if (hasWebhook) {
    stages.push({ key: 'webhook', label: 'Razorpay webhook received', state: 'completed', detail: 'Provider-confirmed payment evidence recorded' });
  }
  if (isRecovered) {
    stages.push({ key: 'recovered', label: 'Recovered', state: 'completed', detail: `${currency(recoveryCase.recoveredAmount || 0, recoveryCase.payment?.currency)} confirmed` });
  }

  if (stages.length === 0) {
    return (
      <div className="evidence-timeline">
        <div className="timeline-empty">No recovery evidence recorded yet.</div>
      </div>
    );
  }

  return (
    <div className="evidence-timeline">
      {stages.map((stage, idx) => (
        <div className={`timeline-stage ${stage.state}`} key={stage.key}>
          <span className={`timeline-dot ${stage.state}`} />
          {idx < stages.length - 1 && <span className="timeline-line" />}
          <div className="timeline-content">
            <strong>{stage.label}</strong>
            {stage.detail && <span>{stage.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
