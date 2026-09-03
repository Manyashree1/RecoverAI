import { useEffect, useMemo, useState } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Clipboard,
  ClipboardList,
  Clock3,
  FileSearch,
  Filter,
  Layers,
  Lock,
  LogOut,
  Menu,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';

import { api, clearSession, getToken, getUser, saveSession } from './api';
import { currency, dateTime, failureCategory, label, number, percent } from './utils';
import {
  EmptyState,
  ErrorState,
  EvidenceNote,
  EvidenceTimeline,
  LoadingState,
  Logo,
  MetricCard,
  MiniBars,
  PageHeader,
  Pipeline,
  SectionHeading,
  StatusBadge,
} from './components';

function App() {
  const [session, setSession] = useState(Boolean(getToken()));
  const [webhookInfo, setWebhookInfo] = useState(null);

  useEffect(() => {
    const onUnauthorized = () => setSession(false);

    window.addEventListener('recoverai:unauthorized', onUnauthorized);

    return () => {
      window.removeEventListener('recoverai:unauthorized', onUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    api.webhookInfo()
      .then((data) => setWebhookInfo(data.data || data))
      .catch(() => setWebhookInfo(null));
  }, [session]);

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={() => setSession(true)} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />

      <Route
        element={
          <Shell
            onLogout={() => {
              clearSession();
              setSession(false);
            }}
            webhookInfo={webhookInfo}
          />
        }
      >
        <Route path="/" element={<Overview />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/payments/:id" element={<PaymentDetail />} />
        <Route path="/recovery-cases" element={<RecoveryCases />} />
        <Route path="/recovery-cases/:id" element={<CaseDetail />} />
        <Route path="/recovery-actions" element={<Actions />} />
        <Route path="/recovery-policy" element={<Policy />} />
        <Route path="/recovery-intelligence" element={<Intelligence />} />
        <Route path="/recovery-batch" element={<RecoveryBatch />} />
        <Route path="/audit" element={<Audit />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      return setError('Enter your merchant email and password.');
    }

    setBusy(true);

    try {
      const payload = await api.login(email, password);
      saveSession(payload);
      onLogin();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-orbit orbit-one" />
      <div className="login-orbit orbit-two" />

      <section className="login-intro">
        <Logo />
        <span className="kicker">Revenue recovery, with receipts</span>

        <h1>
          Turn payment failure into a <em>measurable</em> next move.
        </h1>

        <p>
          RecoverAI helps merchant teams detect risk, understand why a payment
          failed, and act only when policy says it is safe.
        </p>

        <div className="login-proof">
          <span>
            <ShieldCheck size={16} /> Policy-gated
          </span>
          <span>
            <Activity size={16} /> TEST MODE ready
          </span>
          <span>
            <FileSearch size={16} /> Auditable
          </span>
        </div>
      </section>

      <section className="login-card">
        <div className="login-card-head">
          <span className="eyebrow">Merchant console</span>
          <h2>Welcome back</h2>
          <p>Sign in to your recovery command center.</p>
        </div>

        <form onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </label>

          {error && <div className="form-error">{error}</div>}

          <button className="primary-button" disabled={busy}>
            {busy ? (
              <>
                <span className="button-spinner" /> Signing in
              </>
            ) : (
              'Sign in to RecoverAI'
            )}
          </button>
        </form>

        <span className="login-footnote">
          <LockIcon /> Your session is merchant-scoped and verified on every request.
        </span>
      </section>
    </main>
  );
}

function LockIcon() {
  return <ShieldCheck size={14} />;
}

function Shell({ onLogout, webhookInfo }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const user = getUser();

  const links = [
    ['/', 'Overview', BarChart3],
    ['/payments', 'Payments', Receipt],
    ['/recovery-cases', 'Recovery Cases', RefreshCw],
    ['/recovery-actions', 'Recovery Actions', Zap],
    ['/recovery-policy', 'Recovery Policy', ShieldCheck],
    ['/recovery-intelligence', 'Recovery Intelligence', Activity],
    ['/recovery-batch', 'Recovery Batch', Layers],
    ['/audit', 'Audit Trail', FileSearch],
  ];

  const webhookUrl = webhookInfo?.configured ? webhookInfo.webhookUrl : null;

  const copyWebhookUrl = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <Logo />

          <button
            className="icon-button mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav>
          {links.map(([to, text, Icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={17} />
              <span>{text}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sparkles size={15} />
            <span>
              AI advises.
              <br />
              <b>Policy decides.</b>
            </span>
          </div>

          <div className="user-block">
            <div className="avatar">
              {user?.email?.[0]?.toUpperCase() || 'M'}
            </div>

            <div>
              <strong>{user?.email || 'Merchant admin'}</strong>
              <span>Merchant admin</span>
            </div>

            <button
              className="icon-button"
              onClick={onLogout}
              aria-label="Log out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          <div className="topbar-context">
            <span className="live-dot" /> Live recovery workspace
          </div>

          <div className="topbar-right">
            <span className="environment">
              <span /> Razorpay TEST MODE
            </span>

            {webhookUrl && (
              <>
                <span className="topbar-divider" />
                <button className="webhook-url" onClick={copyWebhookUrl} title={copied ? 'Copied' : 'Copy webhook URL'}>
                  <span className="muted">Webhook</span>
                  <span className="mono">{webhookUrl.replace(/^https:\/\//, '')}</span>
                  {copied ? <CheckCircle2 size={12} /> : <Clipboard size={12} />}
                </button>
              </>
            )}

            <span className="topbar-divider" />

            <span className="topbar-user">{user?.email}</span>
          </div>
        </header>

        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function useRequest(loader, dependencies = []) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    data: null,
  });

  const reload = () => {
    setState({
      loading: true,
      error: '',
      data: null,
    });

    loader()
      .then((data) => {
        setState({
          loading: false,
          error: '',
          data,
        });
      })
      .catch((error) => {
        setState({
          loading: false,
          error: error.message,
          data: null,
        });
      });
  };

  useEffect(reload, dependencies);

  return {
    ...state,
    reload,
  };
}

function Overview() {
  const { loading, error, data, reload } = useRequest(api.overview, []);
  const overview = data?.data;

  if (loading) {
    return (
      <>
        <PageHeader
          eyebrow="Command center"
          title="Recovery Command Center"
          description="A live view of where failed payments can still become revenue."
        />
        <LoadingState />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader
          eyebrow="Command center"
          title="Recovery Command Center"
          description="A live view of where failed payments can still become revenue."
          action={
            <button className="secondary-button" onClick={reload}>
              <RefreshCw size={15} /> Retry
            </button>
          }
        />
        <ErrorState message={error} />
      </>
    );
  }

  if (!overview) return null;

  return (
    <>
      <PageHeader
        eyebrow="Command center / Overview"
        title="Recovery Command Center"
        description="A live view of where failed payments can still become revenue."
        action={
          <span className="updated">
            <span className="live-dot" /> Live from persisted records
          </span>
        }
      />

      {getUser()?.email === 'demo@recoverai.test' && (
        <div className="demo-banner">
          <span className="demo-dot" /> Demo mode — seeded revenue is ₹0. Recovery requires a live Razorpay TEST payment + provider webhook.
        </div>
      )}

      <section className="hero-band">
        <div>
          <span className="kicker">The recovery signal</span>

          <h2>
            Every failed payment has a story.
            <br />
            <em>Make the next move legible.</em>
          </h2>

          <p>
            RecoverAI connects diagnosis, policy, bounded execution, and
            measurement in one merchant workflow.
          </p>
        </div>

        <div className="hero-signal">
          <span>Revenue at risk</span>
          <strong>{currency(overview.revenueAtRisk)}</strong>
          <small>
            {number(overview.eligibleRecoveryCases)} eligible cases in motion
          </small>
        </div>
      </section>

      <div className="metrics-grid">
        <MetricCard
          icon={CircleDollarSign}
          label="Recovered revenue"
          value={currency(overview.recoveredRevenue)}
          detail="Provider-confirmed via webhook"
          tone="green"
        />

        <MetricCard
          icon={BarChart3}
          label="Recovery rate"
          value={percent(overview.recoveryRate)}
          detail="Recovered / total recovery opportunities"
          tone="green"
        />

        <MetricCard
          icon={ShieldCheck}
          label="Successful recoveries"
          value={number(overview.successfulRecoveries)}
          detail="With confirmed provider payment"
          tone="green"
        />

        <MetricCard
          icon={AlertIcon}
          label="Escalated to humans"
          value={number(overview.escalatedCases)}
          detail={overview.escalatedAmount ? `${currency(overview.escalatedAmount)} at risk` : 'Automation stopped for review'}
          tone="amber"
        />

        <MetricCard
          icon={LockIcon}
          label="Stopped by policy"
          value={number(overview.stoppedActions || overview.blockedActions)}
          detail={overview.blockedAmount ? `${currency(overview.blockedAmount)} policy-bound` : 'Safety/policy rules applied'}
          tone="cyan"
        />

        <MetricCard
          icon={Activity}
          label="Recovery attempts"
          value={number(overview.recoveryAttempts)}
          detail="Actions executed or in progress"
        />
      </div>

      {overview.funnel && (
        <section className="section-block">
          <SectionHeading
            eyebrow="Recovery funnel"
            title="From detection to recovery"
            action={
              <span className="muted" style={{ fontSize: '12px' }}>
                {overview.eligibleRecoveryCases} eligible at-risk cases
              </span>
            }
          />
          <div className="funnel-container">
            <FunnelBar
              stage="Detected"
              count={overview.funnel.detected?.count || 0}
              amount={overview.funnel.detected?.amount || 0}
              total={overview.funnel.detected?.count || 1}
            />
            <FunnelBar
              stage="Diagnosed"
              count={overview.funnel.diagnosed?.count || 0}
              amount={overview.funnel.diagnosed?.amount || 0}
              total={overview.funnel.detected?.count || 1}
            />
            <FunnelBar
              stage="Recommended"
              count={overview.funnel.recommended?.count || 0}
              amount={overview.funnel.recommended?.amount || 0}
              total={overview.funnel.detected?.count || 1}
            />
            <FunnelBar
              stage="Policy Allowed"
              count={overview.funnel.policyAllowed?.count || 0}
              amount={overview.funnel.policyAllowed?.amount || 0}
              total={overview.funnel.detected?.count || 1}
            />
            <FunnelBar
              stage="Executed"
              count={overview.funnel.executed?.count || 0}
              amount={overview.funnel.executed?.amount || 0}
              total={overview.funnel.detected?.count || 1}
            />
            <FunnelBar
              stage="Recovered"
              count={overview.funnel.recovered?.count || 0}
              amount={overview.funnel.recovered?.amount || 0}
              total={overview.funnel.detected?.count || 1}
              tone="green"
            />
          </div>
          <div className="funnel-legend">
            <span><strong>Detected</strong> — recovery cases created</span>
            <span><strong>Diagnosed</strong> — failure categorized</span>
            <span><strong>Recommended</strong> — action proposed</span>
            <span><strong>Policy allowed</strong> — merchant policy passed</span>
            <span><strong>Executed</strong> — action performed</span>
            <span><strong>Recovered</strong> — provider-confirmed</span>
          </div>
        </section>
      )}

      <section className="section-block">
        <SectionHeading
          eyebrow="Recovery performance"
          title="Where the signal is coming from"
        />

        <div className="charts-grid">
          <MiniBars
            title="Recovery by action"
            subtitle="Which moves are being recommended"
            data={overview.breakdown?.recoveryAction}
          />

          <MiniBars
            title="Failure categories"
            subtitle="Why payments are failing"
            data={overview.breakdown?.failureCategory}
          />

          <MiniBars
            title="Case status"
            subtitle="What happens after detection"
            data={overview.breakdown?.recoveryStatus}
          />
        </div>
      </section>

      <section className="section-block">
        <SectionHeading
          eyebrow="System story"
          title="From failed payment to measured outcome"
        />
        <Pipeline />
      </section>

      <EvidenceNote>
        Numbers above are calculated from your persisted payments, cases,
        actions, and audit events. A payment link being created is{' '}
        <strong>not</strong> counted as recovered revenue &mdash; only
        provider-confirmed evidence counts.
      </EvidenceNote>
    </>
  );
}

function GaugeIcon(props) {
  return <Activity {...props} />;
}

function recommendationSourceLabel(recommendation) {
  const source =
    recommendation?.source ||
    recommendation?.recoveryAction?.recommendation?.source;
  if (source === 'AI_AGENT') return 'AI recommendation';
  if (source === 'SYSTEM') return 'Deterministic fallback recommendation';
  return 'System fallback';
}

function FunnelBar({ stage, count, amount, total, tone = 'blue' }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`funnel-bar ${tone}`}>
      <div className="funnel-bar-top">
        <span className="funnel-stage">{stage}</span>
        <span className="funnel-count">{number(count)}</span>
      </div>
      <div className="funnel-track">
        <span className="funnel-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="funnel-bottom">
        <span className="funnel-amount">{currency(amount)}</span>
        <span className="funnel-pct">{pct}%</span>
      </div>
    </div>
  );
}

function Payments() {
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');

  const paymentsRequest = useRequest(
    () =>
      api.payments({
        limit: 100,
        ...(status ? { status } : {}),
      }),
    [status]
  );

  const casesRequest = useRequest(
    () => api.cases({ limit: 100 }),
    []
  );

  const navigate = useNavigate();

  const payments = paymentsRequest.data?.data || [];
  const cases = casesRequest.data?.data || [];

  const reload = () => {
    paymentsRequest.reload();
    casesRequest.reload();
  };

  const { caseByOriginalPaymentId, caseByProviderPaymentId } = useMemo(() => {
    const caseByOriginalPaymentId = new Map(
      cases
        .filter((item) => item.payment)
        .map((item) => [String(item.payment), item])
    );

    const caseByProviderPaymentId = new Map();

    for (const item of cases) {
      for (const providerPaymentId of item.recoveryProviderPaymentIds || []) {
        caseByProviderPaymentId.set(providerPaymentId, item);
      }
    }

    return {
      caseByOriginalPaymentId,
      caseByProviderPaymentId,
    };
  }, [cases]);

  const journeys = useMemo(
    () =>
      payments
        .filter(
          (payment) =>
            !(
              payment.razorpayPaymentId &&
              caseByProviderPaymentId.has(payment.razorpayPaymentId)
            )
        )
        .filter((payment) =>
          `${payment.id} ${payment.razorpayPaymentId} ${payment.failure?.code}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
        .map((payment) => ({
          payment,
          journeyCase: caseByOriginalPaymentId.get(String(payment.id)),
        })),
    [
      payments,
      caseByOriginalPaymentId,
      caseByProviderPaymentId,
      query,
    ]
  );

  const loading =
    paymentsRequest.loading || casesRequest.loading;

  const error =
    paymentsRequest.error || casesRequest.error;

  return (
    <>
      <PageHeader
        eyebrow="Operations / Payments"
        title="Payment operations"
        description="Find the failure, understand the pressure, and open its recovery story."
        action={
          <button className="secondary-button" onClick={reload}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />

          <input
            placeholder="Search payment or provider ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search payments"
          />
        </div>

        <div className="select-field">
          <Filter size={15} />

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            <option value="FAILED">Failed</option>
            <option value="CAPTURED">Captured</option>
            <option value="AUTHORIZED">Authorized</option>
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingState text="Loading payment ledger" />
      ) : error ? (
        <ErrorState message={error} />
      ) : journeys.length ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Failure signal</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {journeys.map(({ payment, journeyCase }) => (
                <tr
                  key={payment.id}
                  onClick={() =>
                    navigate(
                      journeyCase
                        ? `/recovery-cases/${journeyCase.id}`
                        : `/payments/${payment.id}`
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(
                        journeyCase
                          ? `/recovery-cases/${journeyCase.id}`
                          : `/payments/${payment.id}`
                      );
                    }
                  }}
                  tabIndex={0}
                  role="link"
                >
                  <td>
                    <strong className="mono">
                      {payment.razorpayPaymentId || payment.id}
                    </strong>
                    <span className="table-sub">{payment.id}</span>
                  </td>

                  <td>
                    <strong>
                      {currency(payment.amount, payment.currency)}
                    </strong>
                  </td>

                  <td>
                    <StatusBadge value={payment.status} />
                  </td>

                  <td>
                    {payment.failure?.code ? (
                      <>
                        <span>{label(payment.failure.code)}</span>
                        <span className="table-sub">
                          {failureCategory(payment.failure.code)}
                        </span>
                      </>
                    ) : (
                      <span className="muted">No failure recorded</span>
                    )}
                  </td>

                  <td className="muted">
                    {dateTime(payment.createdAt)}
                  </td>

                  <td>
                    <ChevronIcon />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Receipt}
          title="No payments found"
          text={
            query
              ? 'Try a different search or clear the filter.'
              : 'Payments will appear here when Razorpay events are ingested.'
          }
        />
      )}
    </>
  );
}

function isStoppingRuleReason(reason) {
  if (!reason) return false;
  return /retry count|contacted|exhausted|cooldown|fatigue|automation channels|terminal state|payment.*captured/i.test(reason);
}

function decisionSource(itemAction) {
  if (itemAction.policyDecision?.escalate) return 'stopping';
  if (!itemAction.policyDecision?.reason) return 'policy';
  return isStoppingRuleReason(itemAction.policyDecision.reason) ? 'stopping' : 'policy';
}

function RecoveryCases() {
  const [status, setStatus] = useState('OPEN');
  const [sort, setSort] = useState('priority');

  const {
    loading,
    error,
    data,
    reload,
  } = useRequest(
    () =>
      api.cases({
        limit: 100,
        sort,
        ...(status ? { status } : {}),
      }),
    [status, sort]
  );

  const cases = data?.data || [];

  return (
    <>
      <PageHeader
        eyebrow="Operations / Recovery"
        title="Recovery cases"
        description="A prioritized view of the cases RecoverAI is working through."
        action={
          <button className="secondary-button" onClick={reload}>
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <div className="filter-tabs">
        {[
          ['OPEN', 'Open cases'],
          ['', 'All cases'],
          ['RECOVERED', 'Recovered'],
          ['CLOSED', 'Closed'],
        ].map(([value, text]) => (
          <button
            className={status === value ? 'active' : ''}
            key={text}
            onClick={() => setStatus(value)}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <label className="select-field">
          <span className="field-label">Sort cases</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="priority">Highest recovery potential</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingState text="Loading recovery cases" />
      ) : error ? (
        <ErrorState message={error} />
      ) : cases.length ? (
        <div className="case-grid">
          {cases.map((item) => (
            <Link
              className="case-card"
              to={`/recovery-cases/${item.id}`}
              key={item.id}
            >
              <div className="case-card-top">
                <span className="case-id">
                  CASE / {item.id.slice(-8)}
                </span>

                <StatusBadge value={item.status} />
              </div>

              <h3>
                {label(item.diagnosis?.category || item.status)}
              </h3>

              <div className="case-score">
                <span>Recovery potential</span>
                <strong>{item.recoveryScore ?? 'N/A'}/100</strong>
                <small>{label(item.recoveryScoreClassification || 'NOT_SCORED')}</small>
              </div>

              <p>
                {item.diagnosis?.explanation ||
                  'Awaiting diagnosis and the next policy-gated recovery decision.'}
              </p>

              <div className="case-meta">
                <span>
                  Retries <b>{item.retryCount ?? 0}</b>
                </span>

                <span>
                  Contacts <b>{item.customerContactAttempts ?? 0}</b>
                </span>

                <span>
                  Action <b>{label(item.recommendedAction || 'Pending')}</b>
                </span>

                <ChevronRightIcon />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={RefreshCw}
          title="No cases in this view"
          text="Try another status filter or wait for a failed payment to be detected."
        />
      )}
    </>
  );
}

function ChevronIcon() {
  return <ArrowUpRight size={15} />;
}

function ChevronRightIcon() {
  return <ArrowUpRight size={17} />;
}

function CaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [recommendation, setRecommendation] = useState(null);
  const [actionError, setActionError] = useState('');
  const [executionResult, setExecutionResult] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scoreData, setScoreData] = useState(null);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [reconcileError, setReconcileError] = useState('');
  const [reconciling, setReconciling] = useState(false);

  const caseRequest = useRequest(
    () => api.case(id),
    [id]
  );

  const scoreRequest = useRequest(
    () => api.caseScore(id),
    [id]
  );

  const auditRequest = useRequest(
    () => api.audit({ recoveryCase: id, limit: 50 }),
    [id]
  );

  const item = caseRequest.data?.data;

  useEffect(() => {
    if (!caseRequest.loading && !caseRequest.error && item) {
      setScoreData(scoreRequest.data?.data || null);
    }
  }, [caseRequest.loading, caseRequest.error, item, scoreRequest.data]);

  const runRecommendation = async () => {
    setBusy(true);
    setActionError('');

    try {
      const result = await api.recommend(id);

      setRecommendation(result);

      if (result.recoveryAction) {
        caseRequest.reload();
      }
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const createRecoveryAttempt = async () => {
    setBusy(true);
    setActionError('');

    try {
      setRecommendation(await api.newRecoveryAttempt(id));
      caseRequest.reload();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const executeAction = async () => {
    const actionId = recommendation?.recoveryAction?.id;

    if (!actionId) return;

    setConfirming(false);
    setBusy(true);
    setActionError('');

    try {
      const result = await api.execute(actionId);

      setExecutionResult(result);
      caseRequest.reload();

      if (
        result.outcome === 'FAILED' ||
        result.outcome === 'BLOCKED'
      ) {
        setActionError(
          result.reason || 'The action could not be executed.'
        );
      }
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const reconcilePaymentLink = async () => {
    const paymentLinkId = primaryAction?.paymentLink?.id || primaryAction?.execution?.providerReference;
    if (!paymentLinkId) return;

    setReconciling(true);
    setReconcileError('');
    setReconcileResult(null);

    try {
      const result = await apiFetch(`/api/recovery-actions/${primaryAction.id}/reconcile-paid-link`, {
        method: 'POST',
        body: JSON.stringify({ paymentLinkId })
      });
      setReconcileResult(result);
      caseRequest.reload();
    } catch (error) {
      setReconcileError(error.message);
    } finally {
      setReconciling(false);
    }
  };

  if (caseRequest.loading) {
    return <LoadingState text="Loading recovery story" />;
  }

  if (caseRequest.error) {
    return <ErrorState message={caseRequest.error} />;
  }

  if (!item) return null;

  const originalPayment = item.originalPayment || {};
  const payment = item.payment || {};

  const recommendationData = recommendation?.recommendation;

  const action =
    recommendationData?.action ||
    recommendation?.recoveryAction?.type;

  const policyDecision =
    recommendation?.policyDecision?.decision ||
    recommendation?.recoveryAction?.policyDecision?.decision;

  const actionStatus =
    executionResult?.action?.status ||
    recommendation?.recoveryAction?.status;

  const canExecuteReminder =
    policyDecision === 'ALLOWED' &&
    action === 'CUSTOMER_REMINDER' &&
    ![
      'EXECUTING',
      'EXECUTED',
      'FAILED',
      'PAYMENT_CONFIRMED',
    ].includes(actionStatus) &&
    Boolean(recommendation?.recoveryAction?.id);

  const isTerminal = [
    'RECOVERED',
    'UNRECOVERED',
    'CLOSED',
  ].includes(item.status);

  const confirmedRecovery =
    item.confirmedRecovery ||
    (isTerminal && item.status === 'RECOVERED'
      ? {
          recoveredAt: item.resolvedAt,
          amount: item.recoveredAmount,
        }
      : null);

  const recommendationNotActionable =
    recommendation?.notActionable;

  const recoveryActions = item.recoveryActions || [];

  const primaryAction = recoveryActions.find(
    (a) =>
      a.type === 'CUSTOMER_REMINDER' &&
      a.status === 'EXECUTED'
  );

  const secondaryActions = recoveryActions.filter(
    (a) => a !== primaryAction
  );

  const evidenceSummary =
    item.evidenceSummary || {
      total: 0,
      counts: {},
      keyEvents: [],
      lastEventAt: null,
    };

  return (
    <>
      <button
        className="back-link"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft size={15} /> Back to recovery cases
      </button>

      <PageHeader
        eyebrow="Recovery case"
        title={payment.razorpayPaymentId || item.id}
        description="A complete, evidence-based view of what RecoverAI knows and what it has done."
        action={<StatusBadge value={item.status} />}
      />

      <div className="detail-grid">
        <div className="detail-main">
          <section className="detail-panel payment-summary">
            <div className="panel-label">
              <CircleDollarSign size={15} /> Original payment
            </div>

            <div className="payment-amount">
              {currency(
                originalPayment.amount || payment.amount,
                originalPayment.currency || payment.currency
              )}
            </div>

            <div className="detail-pairs">
              <span>
                <small>Original payment status</small>
                <StatusBadge
                  value={
                    originalPayment.status ||
                    payment.status
                  }
                />
              </span>

              <span>
                <small>Failure</small>
                <b>
                  {label(
                    originalPayment.failure?.code ||
                      payment.failure?.code ||
                      'Not recorded'
                  )}
                </b>
              </span>

              <span>
                <small>Provider ID</small>
                <b className="mono">
                  {originalPayment.razorpayPaymentId ||
                    payment.razorpayPaymentId ||
                    'Not recorded'}
                </b>
              </span>

              <span>
                <small>Detected</small>
                <b>
                  {dateTime(
                    originalPayment.detectedAt ||
                      payment.createdAt
                  )}
                </b>
              </span>
            </div>

            {isTerminal && (
              <EvidenceNote>
                The original payment failed. The recovery outcome below is a separate customer payment, confirmed independently by Razorpay.
              </EvidenceNote>
            )}
          </section>

          <section className="detail-panel journey-panel">
            <div className="panel-label">
              <Activity size={15} /> Recovery journey
            </div>

            <div className="state-rail horizontal">
              <StateRail caseData={item} />
            </div>
          </section>

          <section className="detail-panel evidence-timeline-panel">
            <div className="panel-label">
              <Clock3 size={15} /> Recovery evidence timeline
            </div>
            <EvidenceTimeline
              case={item}
              actions={item.recoveryActions || []}
              auditEvents={(auditRequest.data?.data?.items || []).map((evt) => ({ ...evt, createdAt: evt.createdAt }))}
            />
          </section>

          <section
            className={`detail-panel recovery-outcome ${
              item.status === 'RECOVERED'
                ? 'is-recovered'
                : ''
            }`}
          >
            <div className="panel-label">
              <Activity size={15} /> Recovery outcome
            </div>

            {item.status === 'RECOVERED' ? (
              <>
                <div className="outcome-hero">
                  <span className="outcome-amount">
                    {currency(
                      item.recoveredAmount || 0,
                      payment.currency
                    )}
                    <em>recovered</em>
                  </span>

                  <span className="outcome-confirmed">
                    <CheckCircle2 size={16} />
                    Razorpay payment confirmed
                  </span>
                </div>

                <div className="detail-pairs outcome-facts">
                  <span>
                    <small>Original amount</small>
                    <b>
                      {currency(
                        payment.amount,
                        payment.currency
                      )}
                    </b>
                  </span>

                  <span>
                    <small>Recovered amount</small>
                    <b>
                      {currency(
                        item.recoveredAmount || 0,
                        payment.currency
                      )}
                    </b>
                  </span>

                  <span>
                    <small>Resolved</small>
                    <b>{dateTime(item.resolvedAt)}</b>
                  </span>

                  {confirmedRecovery?.providerPaymentId ? (
                    <span>
                      <small>Provider payment ID</small>
                      <b className="mono">
                        {confirmedRecovery.providerPaymentId}
                      </b>
                    </span>
                  ) : null}
                </div>

                {confirmedRecovery && (
                  <div className="diagnosis-copy confirmation-evidence">
                    <span className="field-label">
                      Confirmation evidence
                    </span>

                    <p>
                      Razorpay verified this recovery via a signed
                      payment link event (RECOVERY_COMPLETED). This is
                      a <strong>separate customer payment</strong>, not
                      a retry of the original failed payment above.
                      {confirmedRecovery.providerPaymentId
                        ? ` Provider payment ID: ${confirmedRecovery.providerPaymentId}.`
                        : ''}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="analysis-grid">
                <div>
                  <span className="field-label">
                    Case status
                  </span>
                  <strong>{label(item.status)}</strong>
                </div>

                <div>
                  <span className="field-label">
                    Recovered amount
                  </span>
                  <strong>
                    {currency(
                      item.recoveredAmount || 0,
                      payment.currency
                    )}
                  </strong>
                </div>

                <div>
                  <span className="field-label">
                    Resolved
                  </span>
                  <strong>
                    {dateTime(item.resolvedAt)}
                  </strong>
                </div>

                <div>
                  <span className="field-label">
                    Eligibility
                  </span>
                  <strong>
                    {isTerminal
                      ? 'Terminal case'
                      : 'Open case'}
                  </strong>
                </div>
              </div>
            )}
          </section>

          {(() => {
            const escalationAction = (item.recoveryActions || []).find((a) => a.type === 'ESCALATE_TO_HUMAN');
            if (!escalationAction) return null;
            const escalationReason = escalationAction.policyDecision?.reason || 'Maximum automated attempts reached.';
            const isStoppingRule = escalationAction.policyDecision?.escalate || /retry count|contacted|exhausted|cooldown|fatigue|automation channels/i.test(escalationReason);
            const isPolicyBlock = !isStoppingRule;
            const stoppingRuleMatch = escalationReason.match(/(MAX_RETRIES_EXHAUSTED|CONTACT_FATIGUE|AUTOMATION_EXHAUSTED|COOLDOWN|TERMINAL_STATE|PAYMENT_CAPTURED)/i);
            const stoppingRuleLabel = stoppingRuleMatch ? stoppingRuleMatch[1].replace(/_/g, ' ').toLowerCase() : null;
            return (
              <section className="detail-panel escalation-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">{isPolicyBlock ? 'Policy decision' : 'Escalated by safety rule'}</span>
                    <h2>{isPolicyBlock ? 'Blocked by merchant policy' : 'Escalated by safety rule — requires human review'}</h2>
                  </div>
                  <AlertIcon />
                </div>
                <div className="escalation-summary">
                  <p>
                    <strong>{isPolicyBlock ? 'Blocked by merchant policy.' : 'Escalated by safety rule.'}</strong>{' '}
                    {escalationReason}
                  </p>
                  <div className="escalation-meta">
                    <span>
                      {isPolicyBlock ? 'Policy' : 'Rule'} <b>{isPolicyBlock ? 'Merchant policy' : (stoppingRuleLabel || 'Safety rule')}</b>
                    </span>
                    <span>
                      {isPolicyBlock ? 'Blocked' : 'Escalated'} at <b>{dateTime(escalationAction.createdAt)}</b>
                    </span>
                    <span>
                      Status{' '}
                      <StatusBadge
                        value={isPolicyBlock ? 'POLICY_BLOCKED' : 'ESCALATED'}
                        tone={isPolicyBlock ? 'danger' : 'warning'}
                      />
                    </span>
                  </div>
                  {isStoppingRule && (
                    <div className="escalation-next-step">
                      <AlertTriangle size={14} />
                      <span>Next step: human review required</span>
                    </div>
                  )}
                  {escalationAction.recommendation?.rationale && (
                    <div className="escalation-context">
                      <span className="field-label">Context for human reviewer</span>
                      <p>{escalationAction.recommendation.rationale}</p>
                    </div>
                  )}
                </div>
              </section>
            );
          })()}

          {primaryAction && (
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">
                    Recovery execution
                  </span>

                  <h2>
                    {label(primaryAction.type)} — Executed
                  </h2>
                </div>

                <ShieldCheck size={21} />
              </div>

              <div className="detail-pairs">
                <span>
                  <small>Status</small>
                  <StatusBadge value={primaryAction.status} />
                </span>

                {primaryAction.execution?.executedAt && (
                  <span>
                    <small>Executed</small>
                    <b>
                      {dateTime(
                        primaryAction.execution.executedAt
                      )}
                    </b>
                  </span>
                )}

                {primaryAction.paymentLink
                  ?.providerPaymentId && (
                  <span>
                    <small>Provider payment ID</small>
                    <b className="mono">
                      {
                        primaryAction.paymentLink
                          .providerPaymentId
                      }
                    </b>
                  </span>
                )}

                {primaryAction.paymentLink?.id && (
                  <span>
                    <small>Payment link</small>
                    <b className="mono">
                      {primaryAction.paymentLink.id}
                    </b>
                  </span>
                )}

                {item.recoveredAmount > 0 && (
                  <span>
                    <small>Recovered amount</small>
                    <b>
                      {currency(
                        item.recoveredAmount,
                        payment.currency
                      )}
                    </b>
                  </span>
                )}
              </div>

              {primaryAction.paymentLink?.url && (
                <a
                  className="payment-link"
                  href={primaryAction.paymentLink.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open payment link
                  <ArrowUpRight size={15} />
                </a>
              )}

              {primaryAction.paymentLink?.id && !primaryAction.paymentLink?.providerPaymentId && !isTerminal && (
                <button
                  className="secondary-button compact"
                  onClick={reconcilePaymentLink}
                  disabled={reconciling}
                >
                  {reconciling ? 'Checking...' : 'Check payment link status'}
                </button>
              )}

              {reconcileResult && (
                <div className={`history-evidence ${reconcileResult.outcome === 'RECOVERED' ? 'paid' : reconcileResult.outcome === 'REJECTED' ? 'error' : ''}`} style={{ marginTop: '8px' }}>
                  {reconcileResult.outcome === 'RECOVERED' && <><CheckCircle2 size={14} /> Recovery confirmed via reconciliation.</>}
                  {reconcileResult.outcome === 'PENDING' && <><Clock3 size={14} /> Payment link not yet paid.</>}
                  {reconcileResult.outcome === 'REJECTED' && <><AlertTriangle size={14} /> {reconcileResult.reason || 'Invalid payment link status.'}</>}
                  {reconcileResult.outcome === 'IGNORED' && <><AlertTriangle size={14} /> Could not reconcile this link.</>}
                </div>
              )}

              {reconcileError && (
                <div className="form-error" style={{ marginTop: '8px' }}>{reconcileError}</div>
              )}

              {primaryAction.paymentLink
                ?.providerPaymentId && (
                <div
                  className="history-evidence paid"
                  style={{ marginTop: '12px' }}
                >
                  <CheckCircle2 size={14} />
                  Payment completed —{' '}
                  {currency(
                    item.recoveredAmount || 0,
                    payment.currency
                  )}{' '}
                  recovered via verified Razorpay webhook.
                </div>
              )}
            </section>
          )}

          {secondaryActions.length > 0 && (
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">
                    {item.status === 'RECOVERED'
                      ? 'Historical policy decisions'
                      : 'Other policy decisions'}
                  </span>

                  <h2>
                    {secondaryActions.length} {item.status === 'RECOVERED' ? 'historical' : 'additional'}
                    action
                    {secondaryActions.length !== 1
                      ? 's'
                      : ''}
                  </h2>
                </div>
              </div>

              <div className="action-history">
                {secondaryActions.map((itemAction) => (
                  <div
                    className="history-row"
                    key={itemAction.id}
                  >
                    <div className="history-top">
                      <div>
                        <span className="field-label">
                          Action
                        </span>

                        <strong>
                          {label(itemAction.type)}
                        </strong>
                      </div>

                      <StatusBadge
                        value={itemAction.status}
                      />
                    </div>

                    <div className="history-meta">
                      <span>
                        {item.status === 'RECOVERED' && 'Historical action · '}
                        Status{' '}
                        <b>
                          {label(itemAction.status)}
                        </b>
                      </span>

                      {itemAction.policyDecision
                        ?.decision && (
                        <span>
                          Policy{' '}
                          <b>
                            {label(
                              itemAction.policyDecision
                                .decision
                            )}
                          </b>
                        </span>
                      )}

                      {itemAction.policyDecision
                        ?.reason && (
                        <span>
                          Reason{' '}
                          <b>
                            {
                              itemAction.policyDecision
                                .reason
                            }
                          </b>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {scoreData && (
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Recovery score</span>
                  <h2>Deterministic intelligence</h2>
                </div>
              </div>
              <div className="analysis-grid">
                <div>
                  <span className="field-label">Score</span>
                  <strong>{scoreData.score}/100</strong>
                </div>
                <div>
                  <span className="field-label">Classification</span>
                  <strong>{label(scoreData.classification)}</strong>
                </div>
                <div>
                  <span className="field-label">Evidence confidence</span>
                  <strong>{percent(scoreData.confidence)}</strong>
                </div>
              </div>
              {scoreData.explanation?.components?.length > 0 && (
                <div style={{ marginTop: '14px' }}>
                  <span className="field-label">Score breakdown</span>
                  <ul className="evidence-list">
                    {scoreData.explanation.components.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              <EvidenceNote>
                This deterministic score estimates how recoverable the case is from persisted evidence. Evidence confidence describes the score inputs; AI recommendation confidence describes confidence in a proposed action. They are different measures, and this score is not an ML prediction.
              </EvidenceNote>
            </section>
          )}

          <section className="detail-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Recommendation</span>
                <h2>
                  AI or deterministic recommendation &amp; policy decision
                </h2>
              </div>

              <Sparkles size={21} />
            </div>

            {recommendationNotActionable ? (
              <div className="recommendation-empty">
                <div>
                  <strong>
                    Case resolved — no new recommendation is
                    actionable
                  </strong>

                  <span>
                    {recommendation.reason ||
                      'This recovery case is no longer open. Re-running the pipeline on a terminal case would only produce a non-actionable recommendation.'}
                  </span>
                </div>
              </div>
            ) : recommendation ? (
              <div className="recommendation-result">
                <div className="recommendation-top">
                  <div>
                    <span className="field-label">
                      Recommended action
                    </span>

                    <strong>{label(action)}</strong>
                  </div>

                  <StatusBadge
                    value={
                      policyDecision || actionStatus
                    }
                    tone={
                      policyDecision === 'ALLOWED'
                        ? 'success'
                        : 'danger'
                    }
                  />
                </div>

                <p>
                  {recommendationData?.reason ||
                    recommendation?.policyDecision?.reason}
                </p>

                {recommendation?.recoveryAction?.capability && (
                  <EvidenceNote>
                    Execution boundary: {recommendation.recoveryAction.capability.label}
                  </EvidenceNote>
                )}

                <div className="recommendation-meta">
                  <span>
                    Confidence{' '}
                    <b>
                      {percent(
                        recommendationData?.confidence ||
                          recommendation?.recoveryAction
                            ?.recommendation?.confidence
                      )}
                    </b>
                  </span>

                  <span>
                    Source{' '}
                    <b>
                      {recommendationSourceLabel(recommendation)}
                    </b>
                  </span>

                  {actionStatus && (
                    <div className="execution-status">
                      <span className="field-label">
                        Recovery action status
                      </span>

                      <StatusBadge value={actionStatus} />
                    </div>
                  )}
                  </div>


                {actionStatus === 'FAILED' &&
                  !isTerminal && (
                    <button
                      className="primary-button compact"
                      onClick={createRecoveryAttempt}
                      disabled={busy}
                    >
                      <RefreshCw size={15} /> Create new
                      recovery attempt
                    </button>
                  )}

                {canExecuteReminder &&
                  !isTerminal && (
                    <button
                      className="primary-button execute-button"
                      onClick={() => setConfirming(true)}
                      disabled={busy}
                    >
                      <Zap size={16} /> Execute Customer
                      Reminder
                    </button>
                  )}

                {executionResult?.paymentLink?.shortUrl &&
                  !isTerminal && (
                    <a
                      className="payment-link"
                      href={
                        executionResult.paymentLink.shortUrl
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Razorpay TEST Payment Link
                      <ArrowUpRight size={15} />
                    </a>
                  )}
              </div>
            ) : (
              <div>
                <div className="recommendation-empty">
                  <div>
                    <strong>
                      {isTerminal
                        ? 'Recovered — no further recommendation needed'
                        : 'No fresh recommendation in this session'}
                    </strong>

                    <span>
                      {isTerminal
                        ? 'This case already reached a terminal recovery outcome. The pipeline cannot generate a new actionable recommendation.'
                        : 'Run the existing backend pipeline to see the current AI or deterministic fallback recommendation.'}
                    </span>
                  </div>

                  {!isTerminal && (
                    <button
                      className="primary-button compact"
                      onClick={runRecommendation}
                      disabled={busy}
                    >
                      {busy
                        ? 'Analysing...'
                        : 'Generate recommendation'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {actionError && (
              <div className="form-error">{actionError}</div>
            )}

            <EvidenceNote>
              AI recommends. Policy decides. A payment link being
              created is not a recovery &mdash; only provider-confirmed
              evidence marks money as recovered.
            </EvidenceNote>
          </section>
        </div>

        <aside className="detail-side">
          <section className="detail-panel audit-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  Evidence log
                </span>
                <h2>Evidence summary</h2>
              </div>
            </div>

            <div className="evidence-summary">
              <p>
                <strong>{evidenceSummary.total}</strong>{' '}
                events recorded
              </p>

              {evidenceSummary.keyEvents.map(
                (evt, idx) => (
                  <div
                    key={idx}
                    className="evidence-event"
                  >
                    <span>{label(evt.type)}</span>
                    <time>{dateTime(evt.at)}</time>
                  </div>
                )
              )}

              {evidenceSummary.lastEventAt && (
                <div className="evidence-event">
                  <span>Latest event</span>
                  <time>
                    {dateTime(
                      evidenceSummary.lastEventAt
                    )}
                  </time>
                </div>
              )}
            </div>

            <Link
              className="text-link"
              to={`/audit?recoveryCase=${id}`}
              style={{
                marginTop: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              View full audit trail
              <ArrowUpRight size={13} />
            </Link>
          </section>
        </aside>
      </div>

      {confirming && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setConfirming(false);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="execute-title"
          >
            <div className="panel-label">
              <ShieldCheck size={15} /> Policy-approved
              execution
            </div>

            <h2 id="execute-title">
              Execute Customer Reminder?
            </h2>

            <p>
              RecoverAI will create a bounded Razorpay TEST
              MODE Payment Link for the customer. This does
              not mark the payment recovered; only a verified
              provider webhook can do that.
            </p>

            <div className="confirm-facts">
              <span>
                <small>Recommended action</small>
                <b>{label(action)}</b>
              </span>

              <span>
                <small>Confidence</small>
                <b>
                  {percent(
                    recommendationData?.confidence
                  )}
                </b>
              </span>

              <span>
                <small>Policy decision</small>
                <b>{label(policyDecision)}</b>
              </span>
            </div>

            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={executeAction}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="button-spinner" />
                    Creating link
                  </>
                ) : (
                  <>
                    <Zap size={16} />
                    Confirm execution
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function LegacyCaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [recommendation, setRecommendation] = useState(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const caseRequest = useRequest(
    () => api.case(id),
    [id]
  );

  const auditRequest = useRequest(
    () => api.audit({ recoveryCase: id, limit: 100 }),
    [id]
  );

  const item = caseRequest.data?.data;
  const events = auditRequest.data?.data || [];

  const runRecommendation = async () => {
    setBusy(true);
    setActionError('');

    try {
      setRecommendation(await api.recommend(id));
      auditRequest.reload();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (caseRequest.loading) {
    return <LoadingState text="Loading recovery story" />;
  }

  if (caseRequest.error) {
    return <ErrorState message={caseRequest.error} />;
  }

  if (!item) return null;

  const payment = item.payment || {};

  return (
    <>
      <button
        className="back-link"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft size={15} /> Back to recovery cases
      </button>

      <PageHeader
        eyebrow="Recovery case"
        title={payment.razorpayPaymentId || item.id}
        description="A complete, evidence-based view of what RecoverAI knows and what it has done."
        action={<StatusBadge value={item.status} />}
      />

      <div className="detail-grid">
        <div className="detail-main">
          <section className="detail-panel payment-summary">
            <div className="panel-label">
              <CircleDollarSign size={15} /> Payment
            </div>

            <div className="payment-amount">
              {currency(payment.amount, payment.currency)}
            </div>

            <div className="detail-pairs">
              <span>
                <small>Status</small>
                <StatusBadge value={payment.status} />
              </span>

              <span>
                <small>Failure</small>
                <b>
                  {label(payment.failure?.code || 'Not recorded')}
                </b>
              </span>

              <span>
                <small>Provider ID</small>
                <b className="mono">
                  {payment.razorpayPaymentId ||
                    'Not recorded'}
                </b>
              </span>

              <span>
                <small>Detected</small>
                <b>{dateTime(payment.createdAt)}</b>
              </span>
            </div>
          </section>

          <section className="detail-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  Diagnosis & decision
                </span>
                <h2>Why this case looks recoverable</h2>
              </div>

              <Bot size={21} />
            </div>

            <div className="analysis-grid">
              <div>
                <span className="field-label">
                  Failure category
                </span>
                <strong>
                  {failureCategory(payment.failure?.code)}
                </strong>
              </div>

              <div>
                <span className="field-label">
                  Eligibility
                </span>
                <strong>
                  {[
                    'RECOVERED',
                    'UNRECOVERED',
                    'CLOSED',
                  ].includes(item.status)
                    ? 'Terminal case'
                    : payment.status === 'FAILED'
                    ? 'Eligible'
                    : 'Not eligible'}
                </strong>
              </div>

              <div>
                <span className="field-label">
                  Retry count
                </span>
                <strong>{item.retryCount ?? 0}</strong>
              </div>

              <div>
                <span className="field-label">
                  Contact attempts
                </span>
                <strong>
                  {item.customerContactAttempts ?? 0}
                </strong>
              </div>
            </div>

            {item.diagnosis ? (
              <div className="diagnosis-copy">
                <span className="field-label">
                  Persisted diagnosis
                </span>
                <p>
                  {item.diagnosis.explanation ||
                    'No explanation recorded.'}
                </p>
              </div>
            ) : (
              <div className="empty-inline">
                Diagnosis will appear when the recommendation
                pipeline records it.
              </div>
            )}
          </section>

          <section className="detail-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">AI analysis</span>
                <h2>Recommendation, then control</h2>
              </div>

              <Sparkles size={21} />
            </div>

            {recommendation ? (
              <div className="recommendation-result">
                <div className="recommendation-top">
                  <div>
                    <span className="field-label">
                      Recommended action
                    </span>

                    <strong>
                      {label(
                        recommendation.recommendation
                          ?.action ||
                          recommendation.recoveryAction
                            ?.type
                      )}
                    </strong>
                  </div>

                  <StatusBadge
                    value={
                      recommendation.policyDecision
                        ?.decision ||
                      recommendation.recoveryAction
                        ?.status
                    }
                    tone={
                      recommendation.policyDecision
                        ?.decision === 'ALLOWED'
                        ? 'success'
                        : 'danger'
                    }
                  />
                </div>

                <p>
                  {recommendation.recommendation?.reason ||
                    recommendation.policyDecision?.reason}
                </p>

                <div className="recommendation-meta">
                  <span>
                    Confidence{' '}
                    <b>
                      {percent(
                        recommendation.recommendation
                          ?.confidence
                      )}
                    </b>
                  </span>

                  <span>
                    Source{' '}
                    <b>
                      {recommendationSourceLabel(recommendation)}
                    </b>
                  </span>
                </div>
              </div>
            ) : (
              <div className="recommendation-empty">
                <div>
                  <strong>
                    No fresh recommendation in this session
                  </strong>

                  <span>
                    Run the existing backend pipeline to see
                    the current AI or deterministic fallback
                    recommendation.
                  </span>
                </div>

                <button
                  className="primary-button compact"
                  onClick={runRecommendation}
                  disabled={busy}
                >
                  {busy
                    ? 'Analysing...'
                    : 'Generate recommendation'}
                </button>
              </div>
            )}

            {actionError && (
              <div className="form-error">{actionError}</div>
            )}

            <EvidenceNote>
              AI recommends. The deterministic policy engine
              authorizes. This screen never treats a
              recommendation as execution.
            </EvidenceNote>
          </section>
        </div>

        <aside className="detail-side">
          <section className="detail-panel">
            <div className="panel-label">
              <Activity size={15} /> Recovery state
            </div>

            <div className="state-rail">
              <StateRail caseData={item} />
            </div>

            <div className="detail-pairs stacked">
              <span>
                <small>Recovered amount</small>
                <b>
                  {currency(
                    item.recoveredAmount || 0,
                    payment.currency
                  )}
                </b>
              </span>

              <span>
                <small>Resolved</small>
                <b>{dateTime(item.resolvedAt)}</b>
              </span>
            </div>
          </section>

          <section className="detail-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  Audit trail
                </span>
                <h2>What happened</h2>
              </div>

              <Link
                className="text-link"
                to={`/audit?recoveryCase=${id}`}
              >
                View all
              </Link>
            </div>

            {auditRequest.loading ? (
              <LoadingState text="Loading events" />
            ) : auditRequest.error ? (
              <ErrorState message={auditRequest.error} />
            ) : events.length ? (
              <Timeline events={events.slice(0, 8)} />
            ) : (
              <EmptyState
                icon={FileSearch}
                title="No events yet"
                text="The audit trail will appear as the case moves."
              />
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function StateRail({ caseData }) {
  const actions = caseData.recoveryActions || [];
  const hasDiagnosis = Boolean(caseData.diagnosis?.explanation);
  const hasRecommendation = actions.length > 0;
  const hasPolicyAllowed = actions.some(
    (a) =>
      ['POLICY_ALLOWED', 'EXECUTING', 'EXECUTED'].includes(a.status) ||
      a.execution?.result === 'PAYMENT_LINK_CREATED' ||
      a.execution?.result === 'PAYMENT_CONFIRMED'
  );
  const hasExecuted = actions.some((a) => a.status === 'EXECUTED');
  const isEscalated = actions.some((a) => a.type === 'ESCALATE_TO_HUMAN');
  const isPolicyBlocked = caseData.status === 'POLICY_BLOCKED';
  const isRecovered = caseData.status === 'RECOVERED';
  const hasStoppingRule = isEscalated && actions.some((a) => {
    const reason = a.policyDecision?.reason || '';
    return /retry count|contacted|exhausted|cooldown|fatigue|automation channels/i.test(reason);
  });

  const stages = [
    { name: 'DETECTED', reached: true },
    { name: 'DIAGNOSED', reached: hasDiagnosis },
    { name: 'RECOMMENDED', reached: hasRecommendation },
  ];

  if (isEscalated && hasStoppingRule) {
    stages.push({ name: 'POLICY EVALUATED', reached: true, tone: 'success' });
    stages.push({ name: 'ESCALATED', reached: true, tone: 'warning' });
  } else if (isEscalated || (isPolicyBlocked && !hasPolicyAllowed)) {
    stages.push({ name: 'POLICY BLOCKED', reached: true, tone: 'danger' });
  } else {
    stages.push({
      name: 'POLICY ALLOWED',
      reached: hasPolicyAllowed,
      tone: hasPolicyAllowed ? 'success' : null,
    });
  }

  stages.push({ name: 'EXECUTED', reached: hasExecuted });
  stages.push({
    name: isRecovered ? 'RECOVERED' : 'NOT RECOVERED',
    reached: isRecovered,
    tone: isRecovered ? 'success' : null,
  });

  return (
    <>
      {stages.map((stage, idx) => (
        <div
          className={`state-step ${stage.reached ? 'done' : ''} ${stage.tone ? `tone-${stage.tone}` : ''}`}
          key={stage.name}
        >
          <span>{stage.reached ? '✓' : idx + 1}</span>

          <strong>{label(stage.name)}</strong>
        </div>
      ))}
    </>
  );
}

function Timeline({ events, groupDemo = false }) {
  if (!groupDemo) {
    return (
      <div className="timeline">
        {[...events].reverse().map((event) => (
          <TimelineItem event={event} key={event.id || `${event.type}-${event.createdAt}`} />
        ))}
      </div>
    );
  }

  const demo = events.filter((e) => isDemoEvent(e));
  const journey = events.filter((e) => !isDemoEvent(e));

  return (
    <div className="timeline">
      {demo.length > 0 && (
        <div className="timeline-group">
          <div className="timeline-group-head">
            <span className="timeline-group-dot demo" />
            <span className="timeline-group-label">Development / demo history</span>
            <span className="timeline-group-count">{demo.length}</span>
          </div>
          {[...demo].reverse().map((event) => (
            <TimelineItem event={event} demo key={event.id || `${event.type}-${event.createdAt}`} />
          ))}
        </div>
      )}
      {journey.length > 0 && (
        <div className="timeline-group">
          <div className="timeline-group-head">
            <span className="timeline-group-dot journey" />
            <span className="timeline-group-label">Recovery journey</span>
            <span className="timeline-group-count">{journey.length}</span>
          </div>
          {[...journey].reverse().map((event) => (
            <TimelineItem event={event} key={event.id || `${event.type}-${event.createdAt}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineItem({ event, demo = false }) {
  const isAiEvent = event.type === 'AI_RECOMMENDATION_GENERATED';
  const isFallbackEvent = event.type === 'AI_FALLBACK_USED';
  const source = event.metadata?.source || event.metadata?.provider;
  return (
    <div className={`timeline-item ${demo ? 'is-demo' : ''} ${isAiEvent ? 'is-ai' : ''} ${isFallbackEvent ? 'is-fallback' : ''}`}>
      <span className="timeline-dot" />

      <div>
        <div className="timeline-meta">
          <strong>{label(event.type)}</strong>
          {isAiEvent && source && (
            <span className="timeline-source ai">
              <Sparkles size={11} /> AI recommendation
            </span>
          )}
          {isFallbackEvent && (
            <span className="timeline-source fallback">
              <ShieldCheck size={11} /> Deterministic fallback
            </span>
          )}
          <time>{dateTime(event.createdAt)}</time>
        </div>

        <p>
          {event.reason ||
            event.result ||
            'Event recorded.'}
        </p>

        {event.action && (
          <span className="timeline-tag">
            {label(event.action)}
          </span>
        )}

        {demo && (
          <span className="timeline-demo-badge">DEMO</span>
        )}
      </div>
    </div>
  );
}

function isDemoEvent(event) {
  if (!event) return false;
  const reason = String(event.reason || '').toLowerCase();
  if (reason.includes('development demo') || reason.includes('development-only')) return true;
  if (event.providerEventId && String(event.providerEventId).startsWith('demo:')) return true;
  return false;
}

function PaymentDetail() {
  const { id } = useParams();

  const paymentRequest = useRequest(
    () => api.payment(id),
    [id]
  );

  const casesRequest = useRequest(
    () => api.cases({ limit: 100 }),
    []
  );

  const payment = paymentRequest.data?.data;
  const cases = casesRequest.data?.data || [];

  const linkedCase = cases.find(
    (item) => String(item.payment) === String(id)
  );

  const owningJourney = payment?.razorpayPaymentId
    ? cases.find((item) =>
        (item.recoveryProviderPaymentIds || []).includes(
          payment.razorpayPaymentId
        )
      )
    : null;

  if (paymentRequest.loading) {
    return <LoadingState text="Loading payment detail" />;
  }

  if (paymentRequest.error) {
    return <ErrorState message={paymentRequest.error} />;
  }

  if (!payment) return null;

  if (owningJourney) {
    return (
      <Navigate
        to={`/recovery-cases/${owningJourney.id}`}
        replace
      />
    );
  }

  return (
    <>
      <Link className="back-link" to="/payments">
        <ArrowLeft size={15} /> Back to payments
      </Link>

      <PageHeader
        eyebrow="Payment detail"
        title={payment.razorpayPaymentId || payment.id}
        description="The payment record that started this recovery journey."
        action={<StatusBadge value={payment.status} />}
      />

      <div className="single-detail">
        <section className="detail-panel">
          <div className="payment-amount">
            {currency(
              payment.amount,
              payment.currency
            )}
          </div>

          <div className="detail-pairs">
            <span>
              <small>Payment ID</small>
              <b className="mono">{payment.id}</b>
            </span>

            <span>
              <small>Provider payment ID</small>
              <b className="mono">
                {payment.razorpayPaymentId ||
                  'Not recorded'}
              </b>
            </span>

            <span>
              <small>Failure category</small>
              <b>
                {failureCategory(payment.failure?.code)}
              </b>
            </span>

            <span>
              <small>Recorded</small>
              <b>{dateTime(payment.createdAt)}</b>
            </span>
          </div>

          <div className="failure-callout">
            <AlertIcon />

            <div>
              <strong>
                {label(
                  payment.failure?.code || 'No failure'
                )}
              </strong>

              <span>
                {payment.failure?.description ||
                  'No failure details were recorded for this payment.'}
              </span>
            </div>
          </div>

          {linkedCase ? (
            <Link
              className="primary-button inline-button"
              to={`/recovery-cases/${linkedCase.id}`}
            >
              Open recovery case
              <ArrowUpRight size={15} />
            </Link>
          ) : (
            <EvidenceNote>
              No recovery case is linked to this payment.
            </EvidenceNote>
          )}
        </section>
      </div>
    </>
  );
}

function AlertIcon() {
  return <AlertTriangle size={18} />;
}

/* =========================================================
   FIXED ACTIONS COMPONENT
   ========================================================= */

function Actions() {
  const [refreshKey, setRefreshKey] = useState(0);

  const {
    loading,
    error,
    data,
  } = useRequest(
    () => api.recoveryActions({ t: refreshKey }),
    [refreshKey]
  );

  const items = data?.data || [];
  const pagination = data?.pagination;

  return (
    <>
      <PageHeader
        eyebrow="Operations / Actions"
        title="Recovery actions"
        description="A read-only ledger of what RecoverAI recommended, what policy decided, and what actually happened."
        action={
          <button
            className="secondary-button"
            onClick={() =>
              setRefreshKey((k) => k + 1)
            }
            disabled={loading}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      {loading ? (
        <LoadingState text="Loading action ledger" />
      ) : error ? (
        <ErrorState message={error} />
      ) : items.length ? (
        <div className="table-shell">
          <table>
            <thead>
                <tr>
                 <th>Action</th>
                 <th>Recovery case</th>
                 <th>Status</th>
                 <th>Policy / stopping</th>
                 <th>Execution / outcome</th>
                 <th>Timestamp</th>
               </tr>
            </thead>

            <tbody>
              {items.map((itemAction) => (
                <tr key={itemAction.id || `${itemAction.type}-${itemAction.createdAt}`}>
                  <td>
                    <strong>
                      {label(itemAction.type)}
                    </strong>
                  </td>

                  <td>
                    {itemAction.recoveryCase ? (
                      <Link
                        to={`/recovery-cases/${itemAction.recoveryCase.id}`}
                        className="text-link"
                      >
                        {itemAction.recoveryCase.id.slice(-8)}
                        <ArrowUpRight size={12} />
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>

                  <td>
                    <StatusBadge
                      value={itemAction.status}
                    />
                  </td>

                    <td className="policy-cell">
                      {itemAction.policyDecision
                        ?.decision ? (
                        <>
                          <StatusBadge
                            value={
                              itemAction.policyDecision
                                .decision
                            }
                          />
                          <span className={`cell-source ${decisionSource(itemAction)}`}>
                            {decisionSource(itemAction) === 'stopping' ? 'Escalated by safety rule' : 'Blocked by merchant policy'}
                          </span>
                        </>
                      ) : (
                        <span className="muted">
                          Not evaluated
                        </span>
                      )}
                      {itemAction.policyDecision
                        ?.reason && (
                        <div className="cell-reason">
                          {itemAction.policyDecision.reason.length > 60
                            ? `${itemAction.policyDecision.reason.slice(0, 60)}...`
                            : itemAction.policyDecision.reason}
                        </div>
                      )}
                    </td>

                  <td>
                    {itemAction.status === 'EXECUTED' &&
                    itemAction.paymentLink ? (
                      <>
                        <span className={`history-evidence ${itemAction.paymentLink.providerPaymentId ? 'paid' : 'pending'}`}>
                          <CheckCircle2 size={13} />
                          {itemAction.paymentLink.providerPaymentId ? 'Recovered' : 'Payment link created'}
                        </span>

                        {itemAction.paymentLink
                          .providerPaymentId && (
                          <div>
                            <b className="mono">
                              {
                                itemAction.paymentLink
                                  .providerPaymentId
                              }
                            </b>
                          </div>
                        )}

                        {itemAction.paymentLink.url && (
                          <a
                            className="text-link"
                            href={
                              itemAction.paymentLink.url
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open link
                            <ArrowUpRight size={12} />
                          </a>
                        )}
                      </>
                    ) : itemAction.status === 'POLICY_BLOCKED' ||
                        itemAction.status === 'BLOCKED' ? (
                      <span className="muted">Not executed</span>
                    ) : (
                      <span className="muted">
                        {label(
                          itemAction.execution?.result ||
                            itemAction.status
                        )}
                      </span>
                    )}
                  </td>

                  <td className="muted">
                    {dateTime(itemAction.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={Zap} title="No recovery actions found" text="Actions will appear after RecoverAI records a recommendation for a recovery case." />
      )}

      <div className="ledger-footer">
        {pagination && (
          <span className="muted">
            {pagination.total} total actions
          </span>
        )}
      </div>
    </>
  );
}

function Policy() {
  const [policy, setPolicy] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dirty, setDirty] = useState(false);

  const loadPolicy = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.policy();
      setPolicy(result.data);
        setForm({
          maxAutomaticRetries: result.data.maxAutomaticRetries,
          maxCustomerContactAttempts: result.data.maxCustomerContactAttempts,
          maxTransactionAmount: result.data.maxTransactionAmount / 100,
          cooldownMinutes: result.data.cooldownMinutes,
          escalationCooldownMinutes: result.data.escalationCooldownMinutes,
          allowedActions: [...(result.data.allowedActions || [])],
          expectedVersion: result.data.version
        });
      setDirty(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicy();
  }, []);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
    setSuccess('');
    setError('');
  };

  const toggleAction = (action) => {
    setForm((prev) => {
      const current = prev.allowedActions || [];
      const next = current.includes(action) ? current.filter((a) => a !== action) : [...current, action];
      return { ...prev, allowedActions: next };
    });
    setDirty(true);
    setSuccess('');
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        maxAutomaticRetries: form.maxAutomaticRetries,
        maxCustomerContactAttempts: form.maxCustomerContactAttempts,
        maxTransactionAmount: Math.round(form.maxTransactionAmount * 100),
        cooldownMinutes: form.cooldownMinutes,
        escalationCooldownMinutes: form.escalationCooldownMinutes,
        allowedActions: form.allowedActions,
        expectedVersion: form.expectedVersion
      };
      const result = await api.updatePolicy(payload);
      setPolicy(result.data);
      setForm((prev) => ({ ...prev, expectedVersion: result.data.version }));
      setDirty(false);
      setSuccess('Policy updated successfully.');
    } catch (err) {
      if (err.message.includes('modified elsewhere')) {
        setError('Policy was changed in another session. Refresh to see the latest version.');
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader
          eyebrow="Configuration / Policy"
          title="Recovery policy"
          description="Control how RecoverAI acts on failed payments for your merchant account."
        />
        <LoadingState text="Loading recovery policy" />
      </>
    );
  }

  if (!form) {
    return (
      <>
        <PageHeader
          eyebrow="Configuration / Policy"
          title="Recovery policy"
          description="Control how RecoverAI acts on failed payments for your merchant account."
        />
        <ErrorState message={error || 'Unable to load policy.'} />
      </>
    );
  }

  const actionOptions = [
    { value: 'CUSTOMER_REMINDER', label: 'Customer Reminder', description: 'Executable: creates a Razorpay TEST payment link; provider confirmation is still required.' },
    { value: 'RETRY_PAYMENT', label: 'Retry Payment', description: 'Recommendation only: direct charge retry is not supported by the current TEST adapter.' },
    { value: 'PAYMENT_METHOD_UPDATE', label: 'Payment Method Update', description: 'Recommendation only: requires customer interaction outside the current adapter.' },
    { value: 'ESCALATE_TO_HUMAN', label: 'Escalate to Human', description: 'Human workflow; no automatic provider action is performed.' }
  ];

  const allowedSet = new Set(form.allowedActions || []);
  const blockedActions = actionOptions.filter((opt) => !allowedSet.has(opt.value));

  return (
    <>
      <PageHeader
        eyebrow="Configuration / Policy"
        title="Recovery policy"
        description="Control how RecoverAI acts on failed payments for your merchant account."
        action={
          policy?.updatedAt ? (
            <span className="updated">
              Last updated: {dateTime(policy.updatedAt)}
            </span>
          ) : null
        }
      />

      <form onSubmit={submit}>
        <div className="detail-grid">
          <div className="detail-main">
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Allowed actions</span>
                  <h2>What RecoverAI may do</h2>
                </div>
                <ShieldCheck size={21} />
              </div>
              <div className="policy-actions">
                {actionOptions.map((opt) => (
                  <label className={`policy-action ${allowedSet.has(opt.value) ? 'is-allowed' : ''}`} key={opt.value}>
                    <input
                      type="checkbox"
                      checked={allowedSet.has(opt.value)}
                      onChange={() => toggleAction(opt.value)}
                    />
                    <div>
                      <strong>{opt.label}</strong>
                      <span>{opt.description}</span>
                    </div>
                  </label>
                ))}
                <p className="policy-actions-note">Policy controls which recovery paths are permitted; actual execution is additionally constrained by RecoverAI's bounded executor and provider capabilities.</p>
              </div>
            </section>

            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Automation limits</span>
                  <h2>Bounded execution</h2>
                </div>
                <Activity size={21} />
              </div>
              <div className="policy-fields">
                <label className="policy-field">
                  <span>
                    <strong>Maximum automatic retries</strong>
                    <small>How many times RecoverAI can retry a failed payment before escalating.</small>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={form.maxAutomaticRetries}
                    onChange={(e) => updateField('maxAutomaticRetries', Number(e.target.value))}
                  />
                </label>
                <label className="policy-field">
                  <span>
                    <strong>Maximum automatic recovery amount</strong>
                    <small>Payment amounts above this merchant-controlled limit cannot be recovered automatically.</small>
                  </span>
                  <span className="amount-input">
                    <span className="amount-prefix">₹</span>
                    <input
                      type="number"
                      min="1"
                      max="1000000"
                      value={form.maxTransactionAmount}
                      onChange={(e) => updateField('maxTransactionAmount', Number(e.target.value))}
                    />
                  </span>
                </label>
                <label className="policy-field">
                  <span>
                    <strong>Maximum customer contacts</strong>
                    <small>How many times RecoverAI can contact a customer before stopping.</small>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={form.maxCustomerContactAttempts}
                    onChange={(e) => updateField('maxCustomerContactAttempts', Number(e.target.value))}
                  />
                </label>
              </div>
            </section>

            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Safety timing</span>
                  <h2>Cooldown periods</h2>
                </div>
                <Clock3 size={21} />
              </div>
              <div className="policy-fields">
                <label className="policy-field">
                  <span>
                    <strong>Recovery cooldown (minutes)</strong>
                    <small>Minimum time between consecutive recovery actions on the same case.</small>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="10080"
                    value={form.cooldownMinutes}
                    onChange={(e) => updateField('cooldownMinutes', Number(e.target.value))}
                  />
                </label>
                <label className="policy-field">
                  <span>
                    <strong>Escalation cooldown (minutes)</strong>
                    <small>Minimum time before a case can be escalated again after a prior escalation.</small>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="43200"
                    value={form.escalationCooldownMinutes}
                    onChange={(e) => updateField('escalationCooldownMinutes', Number(e.target.value))}
                  />
                </label>
              </div>
            </section>

            {error && <div className="form-error">{error}</div>}
            {success && <div className="form-success">{success}</div>}

            <div className="policy-footer">
              <button
                type="submit"
                className="primary-button"
                disabled={saving || !dirty}
              >
                {saving ? (
                  <>
                    <span className="button-spinner" /> Saving
                  </>
                ) : (
                  'Save policy'
                )}
              </button>
              {dirty && <span className="unsaved-indicator">Unsaved changes</span>}
            </div>
          </div>

          <aside className="detail-side">
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Policy status</span>
                  <h2>Current effect</h2>
                </div>
              </div>
              <div className="policy-status">
                <div className="policy-status-row">
                  <span className="status-dot active" />
                  <span>Policy active</span>
                </div>
                <div className="policy-status-row muted">
                  <span>Version {policy?.version ?? 0}</span>
                </div>
              </div>
            </section>

            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Allowed</span>
                  <h2>RecoverAI may execute</h2>
                </div>
                <CheckCircle2 size={21} />
              </div>
              <div className="policy-effects">
                {actionOptions.filter((opt) => allowedSet.has(opt.value)).map((opt) => (
                  <span className="effect-allowed" key={opt.value}>
                    <CheckCircle2 size={13} /> {opt.label}
                  </span>
                ))}
              </div>
            </section>

            {blockedActions.length > 0 && (
              <section className="detail-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Blocked</span>
                    <h2>RecoverAI will not execute</h2>
                  </div>
                  <Lock size={21} />
                </div>
                <div className="policy-effects">
                  {blockedActions.map((opt) => (
                    <span className="effect-blocked" key={opt.value}>
                      <X size={13} /> {opt.label}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <EvidenceNote>
              RecoverAI recommends actions using AI or deterministic recovery
              intelligence, but execution is always constrained by this merchant
              policy and the safety stopping rules.
            </EvidenceNote>
          </aside>
        </div>
      </form>
    </>
  );
}

function auditEventStage(event) {
  if (event.type === 'PAYMENT_FAILED' || event.type === 'RECOVERY_CASE_CREATED') return 'Detection';
  if (event.type === 'AI_ANALYSIS_STARTED' || event.type === 'AI_RECOMMENDATION_GENERATED' || event.type === 'AI_FALLBACK_USED') return 'Recommendation';
  if (event.type === 'POLICY_EVALUATED') return 'Policy';
  if (event.type === 'ACTION_EXECUTION_STARTED' || event.type === 'ACTION_EXECUTION_COMPLETED') return 'Execution';
  if (event.type === 'RECOVERY_COMPLETED') return 'Recovery';
  if (event.type === 'ACTION_EXECUTION_BLOCKED' || event.type === 'ACTION_EXECUTION_FAILED' || event.type === 'RECOVERY_CASE_CLOSED') return 'Outcome';
  return 'Evidence';
}

function auditCaseKey(event, index) {
  return event.recoveryCase || `unassigned-${event.payment || 'event'}-${index}`;
}

function auditFinalStatus(events) {
  if (events.some((event) => event.type === 'RECOVERY_COMPLETED')) return 'RECOVERED';
  if (events.some((event) => event.type === 'ACTION_EXECUTION_FAILED')) return 'FAILED_EXECUTION';
  if (events.some((event) => event.type === 'ACTION_EXECUTION_BLOCKED')) return 'EXECUTION_BLOCKED';
  if (events.some((event) => event.type === 'POLICY_EVALUATED' && event.policyDecision === 'BLOCKED')) return 'POLICY_BLOCKED';
  if (events.some((event) => event.type === 'ESCALATED_TO_HUMAN' || event.result === 'ESCALATED_TO_HUMAN')) return 'ESCALATED';
  return 'IN_PROGRESS';
}

function buildAuditStories(events) {
  const stories = new Map();
  events.forEach((event, index) => {
    const key = auditCaseKey(event, index);
    if (!stories.has(key)) stories.set(key, []);
    stories.get(key).push(event);
  });
  return [...stories.entries()].map(([key, caseEvents]) => ({
    key,
    isUnlinked: key.startsWith('unassigned-'),
    events: caseEvents.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt)),
    finalStatus: auditFinalStatus(caseEvents)
  })).sort((left, right) => new Date(right.events.at(-1)?.createdAt || 0) - new Date(left.events.at(-1)?.createdAt || 0));
}

function buildAuditAttempts(events) {
  const attempts = [];
  const byAction = new Map();
  for (const event of events) {
    const actionKey = event.recoveryAction || event.action;
    if (actionKey) {
      if (!byAction.has(actionKey)) {
        const attempt = { label: `Attempt ${attempts.length + 1}`, events: [] };
        attempts.push(attempt);
        byAction.set(actionKey, attempt);
      }
      byAction.get(actionKey).events.push(event);
    } else {
      const latest = attempts.at(-1);
      if (latest && ['AI_ANALYSIS_STARTED', 'AI_RECOMMENDATION_GENERATED', 'AI_FALLBACK_USED'].includes(event.type)) latest.events.push(event);
      else attempts.push({ label: attempts.length ? `Evidence ${attempts.length + 1}` : 'Detection', events: [event] });
    }
  }
  return attempts;
}

function auditPatternGroups(stories) {
  const groups = new Map();
  for (const story of stories) {
    const recommendation = story.events.find((event) => event.action && event.type === 'ACTION_RECOMMENDED');
    const policy = story.events.find((event) => event.type === 'POLICY_EVALUATED');
    const action = recommendation?.action || policy?.action || 'No action recorded';
    const policyReason = policy?.reason || 'No policy decision recorded';
    const key = `${action}|${policyReason}|${story.finalStatus}`;
    if (!groups.has(key)) groups.set(key, { action, policyReason, finalStatus: story.finalStatus, stories: [] });
    groups.get(key).stories.push(story);
  }
  return [...groups.values()].sort((left, right) => right.stories.length - left.stories.length);
}

function AuditRawEvents({ events }) {
  return <details className="audit-disclosure">
    <summary><FileSearch size={14} /> View raw events ({events.length})</summary>
    <div className="timeline">
      {[...events].reverse().map((event, index) => <div key={event.id || `${event.type}-${event.createdAt}-${index}`}><TimelineItem event={event} demo={isDemoEvent(event)} /><div className="audit-raw-details"><span>Case: {event.recoveryCase || 'Not linked'}</span><span>Payment: {event.payment || 'Not linked'}</span><span>Provider: {event.metadata?.provider || 'Not specified'}</span><span>Event ID: {event.providerEventId || 'Not recorded'}</span><span>Result: {event.result || 'Not recorded'}</span>{event.metadata && <pre>{JSON.stringify(event.metadata, null, 2)}</pre>}</div></div>)}
    </div>
  </details>;
}

function AuditStory({ story }) {
  const events = story.events;
  const latest = events.at(-1);
  const completed = events.find((event) => event.type === 'RECOVERY_COMPLETED');
  const amount = completed?.metadata?.amount || events.find((event) => event.metadata?.amount)?.metadata?.amount;
  const recommendation = events.find((event) => event.type === 'ACTION_RECOMMENDED');
  const attempts = buildAuditAttempts(events);
  return <article className={`audit-story audit-story-${story.finalStatus.toLowerCase()}`}>
    <div className="audit-story-header">
      <div><span className="eyebrow">{story.isUnlinked ? 'Provider event' : 'Recovery case'}</span><h2>{story.isUnlinked ? 'Unlinked provider evidence' : story.key}</h2><p>{amount ? currency(amount, completed?.metadata?.currency || 'INR') : story.isUnlinked ? 'Payment amount available in the linked payment record' : 'Amount not recorded in these events'}{recommendation?.action ? ` · ${label(recommendation.action)}` : ''}</p></div>
      <div className="audit-story-outcome">{story.finalStatus === 'RECOVERED' ? <><strong>✓ RECOVERED</strong><span>{amount ? currency(amount, completed?.metadata?.currency || 'INR') : 'Confirmed by Razorpay'}</span><small>Confirmed by Razorpay</small></> : <StatusBadge value={story.finalStatus} />}</div>
    </div>
    <div className="audit-story-meta"><span>Latest <b>{dateTime(latest?.createdAt)}</b></span><span>Events <b>{events.length}</b></span><span>Attempts <b>{attempts.filter((attempt) => attempt.label.startsWith('Attempt')).length}</b></span></div>
    <div className="audit-attempts">{attempts.map((attempt, index) => <details key={`${attempt.label}-${index}`} open={attempts.length === 1}><summary>{attempt.label}<span>{attempt.events.length} event{attempt.events.length === 1 ? '' : 's'}</span></summary><div className="audit-stage-list">{attempt.events.map((event, eventIndex) => <div className="audit-stage" key={event.id || `${event.type}-${event.createdAt}-${eventIndex}`}><span className="audit-stage-name">{auditEventStage(event)}</span><div><strong>{label(event.type)}</strong>{event.action && <span className="timeline-tag">{label(event.action)}</span>}<time>{dateTime(event.createdAt)}</time><p>{event.reason || event.result || 'Event recorded.'}</p>{event.metadata?.provider && <small>Provider: {event.metadata.provider}</small>}</div></div>)}</div></details>)}</div>
    <AuditRawEvents events={events} />
  </article>;
}

function Audit() {
  const location = useLocation();

  const params = new URLSearchParams(
    location.search
  );

  const [type, setType] = useState('');
  const [query, setQuery] = useState(
    params.get('recoveryCase') || ''
  );
  const [showDemo, setShowDemo] = useState(false);

  const {
    loading,
    error,
    data,
    reload,
  } = useRequest(
    () =>
      api.audit({
        limit: 100,
        ...(query ? { recoveryCase: query } : {}),
      }),
    [query]
  );

  const events = data?.data || [];

  const filtered = events.filter((event) => !type || event.type === type);
  const visibleEvents = showDemo ? filtered : filtered.filter((event) => !isDemoEvent(event));
  const stories = buildAuditStories(visibleEvents);
  const caseStories = stories.filter((story) => !story.isUnlinked);
  const unlinkedStories = stories.filter((story) => story.isUnlinked);
  const patterns = auditPatternGroups(caseStories);

  const eventTypes = [
    ...new Set(events.map((event) => event.type)),
  ];

  const demoCount = events.filter((e) => isDemoEvent(e)).length;

  return (
    <>
      <PageHeader
        eyebrow="Governance / Audit"
        title="Audit trail"
        description="A chronological, append-only account of what happened, why, and under whose authority."
        action={
          <button
            className="secondary-button"
            onClick={reload}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />

      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />

          <input
            placeholder="Filter by recovery case ID"
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            aria-label="Filter audit events by recovery case ID"
          />
        </div>

        <div className="select-field">
          <SlidersHorizontal size={15} />

          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value)
            }
          >
            <option value="">All event types</option>

            {eventTypes.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </div>

        {demoCount > 0 && (
          <button
            className={`filter-toggle ${showDemo ? 'active' : ''}`}
            onClick={() => setShowDemo((v) => !v)}
          >
            <Filter size={14} />
            {showDemo ? 'Hiding' : 'Show'} demo ({demoCount})
          </button>
        )}
      </div>

      {!loading && !error && events.length > 0 && (
        <section className="audit-summary detail-panel">
          <div className="panel-heading"><div><span className="eyebrow">Investigation summary</span><h2>AI advises. Policy decides. Provider confirms.</h2></div></div>
          <div className="analysis-grid"><div><span className="field-label">Total events</span><strong>{visibleEvents.length}</strong></div><div><span className="field-label">Recovery cases</span><strong>{caseStories.length}</strong></div><div><span className="field-label">Recommendations</span><strong>{visibleEvents.filter((event) => event.type === 'ACTION_RECOMMENDED').length}</strong></div><div><span className="field-label">Policy decisions</span><strong>{visibleEvents.filter((event) => event.type === 'POLICY_EVALUATED').length}</strong></div><div><span className="field-label">Executions</span><strong>{visibleEvents.filter((event) => event.type.startsWith('ACTION_EXECUTION_')).length}</strong></div><div><span className="field-label">Razorpay recoveries</span><strong>{visibleEvents.filter((event) => event.type === 'RECOVERY_COMPLETED').length}</strong></div><div><span className="field-label">Blocked actions</span><strong>{visibleEvents.filter((event) => event.type === 'ACTION_EXECUTION_BLOCKED' || (event.type === 'POLICY_EVALUATED' && event.policyDecision === 'BLOCKED')).length}</strong></div><div><span className="field-label">Escalations</span><strong>{visibleEvents.filter((event) => event.result === 'ESCALATED_TO_HUMAN').length}</strong></div></div>
          {patterns.length > 0 && <div className="audit-patterns"><span className="field-label">Repeated recovery patterns</span>{patterns.map((group) => <details key={`${group.action}|${group.policyReason}|${group.finalStatus}`}><summary>{label(group.action)} · {group.stories.length} case{group.stories.length === 1 ? '' : 's'}<StatusBadge value={group.finalStatus} /></summary><p>Policy: {group.policyReason}</p><div>{group.stories.map((story) => <Link key={story.key} to={`/audit?recoveryCase=${story.key}`}>{story.key}</Link>)}</div></details>)}</div>}
          {unlinkedStories.length > 0 && <div className="audit-unlinked-note">{unlinkedStories.length} unlinked provider event{unlinkedStories.length === 1 ? '' : 's'} remain visible below and are excluded from the Recovery cases count.</div>}
        </section>
      )}

      {loading ? (
        <LoadingState text="Loading audit events" />
      ) : error ? (
        <ErrorState message={error} />
      ) : visibleEvents.length ? (
        <div className="audit-list">
          {stories.map((story) => <AuditStory key={story.key} story={story} />)}
        </div>
      ) : (
        <EmptyState
          icon={FileSearch}
          title="No audit events match the selected filters"
          text="Try another event type or recovery case ID."
        />
      )}

      <EvidenceNote>
        The audit stream is append-only. Development/demo events are
        identified automatically and can be toggled above. Only
        provider-confirmed events prove money was recovered.
      </EvidenceNote>
    </>
  );
}

function Intelligence() {
  const [activeTab, setActiveTab] = useState('performance');
  const [performanceData, setPerformanceData] = useState(null);
  const [outcomesData, setOutcomesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.performance().catch((err) => ({ error: err.message })),
      api.outcomes().catch((err) => ({ error: err.message }))
    ]).then(([perf, outcomes]) => {
      if (cancelled) return;
      if (perf.error) setError(perf.error);
      else setPerformanceData(perf.data);
      if (outcomes.error) setError(outcomes.error);
      else setOutcomesData(outcomes.data);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err.message);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Intelligence" title="Recovery intelligence" description="Deterministic recovery performance and action effectiveness." />
        <LoadingState text="Loading recovery intelligence" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader eyebrow="Intelligence" title="Recovery intelligence" description="Deterministic recovery performance and action effectiveness." />
        <ErrorState message={error} />
      </>
    );
  }

  const summary = performanceData?.summary || {};
  const series = performanceData?.series || [];
  const outcomes = outcomesData?.outcomes || {};

  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Recovery intelligence"
        description="Deterministic recovery performance and action effectiveness."
      />

      <div className="toolbar">
        <div className="tab-bar">
          <button className={`tab ${activeTab === 'performance' ? 'active' : ''}`} onClick={() => setActiveTab('performance')}>Performance</button>
          <button className={`tab ${activeTab === 'outcomes' ? 'active' : ''}`} onClick={() => setActiveTab('outcomes')}>Action effectiveness</button>
        </div>
      </div>

      {activeTab === 'performance' && (
        <div className="detail-grid">
          <div className="detail-main">
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Recovery performance</span>
                  <h2>Overall effectiveness</h2>
                </div>
              </div>
              <div className="analysis-grid">
                <div>
                  <span className="field-label">Eligible cases</span>
                  <strong>{summary.totalEligible ?? 0}</strong>
                </div>
                <div>
                  <span className="field-label">Recovered</span>
                  <strong>{summary.totalRecovered ?? 0}</strong>
                </div>
                <div>
                  <span className="field-label">Recovery rate</span>
                  <strong>{percent(summary.recoveryRate)}</strong>
                </div>
                <div>
                  <span className="field-label">Revenue recovered</span>
                  <strong>{currency(summary.recoveredAmount)}</strong>
                </div>
                <div>
                  <span className="field-label">Avg. recovered amount</span>
                  <strong>{currency(summary.averageRecoveredAmount)}</strong>
                </div>
                <div>
                  <span className="field-label">Avg. time to recovery</span>
                  <strong>{summary.averageTimeToRecoveryMs ? `${Math.round(summary.averageTimeToRecoveryMs / 1000 / 60)} min` : 'N/A'}</strong>
                </div>
              </div>
            </section>

            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Daily trend</span>
                  <h2>Recovery performance over time</h2>
                </div>
              </div>
              {series.length === 0 ? (
                <EmptyState icon={BarChart3} title="No data yet" text="Recovery performance data will appear once cases reach terminal states." />
              ) : (
                <div className="ledger-wrapper">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Eligible</th>
                        <th>Recovered</th>
                        <th>Recovery rate</th>
                        <th>Recovered amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((row) => (
                        <tr key={row.day}>
                          <td>{row.day}</td>
                          <td>{row.eligibleCount}</td>
                          <td>{row.recoveredCount}</td>
                          <td>{percent(row.recoveryRate)}</td>
                          <td>{currency(row.recoveredAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="detail-side">
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Score</span>
                  <h2>Deterministic</h2>
                </div>
              </div>
              <EvidenceNote>
                Recovery intelligence is derived deterministically from persisted evidence only. No ML model is used. Historical customer behavior is never fabricated.
              </EvidenceNote>
            </section>
          </aside>
        </div>
      )}

      {activeTab === 'outcomes' && (
        <div className="detail-grid">
          <div className="detail-main">
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Action effectiveness</span>
                  <h2>What actually recovers money</h2>
                </div>
              </div>
              {Object.keys(outcomes).length === 0 ? (
                <EmptyState icon={BarChart3} title="No outcome data yet" text="Outcome data requires provider-confirmed recoveries." />
              ) : (
                <div className="ledger-wrapper">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Recommended</th>
                        <th>Executed</th>
                        <th>Recovered</th>
                        <th>Recovery rate</th>
                        <th>Avg. recovered amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(outcomes).map(([action, data]) => (
                        <tr key={action}>
                          <td>{label(action)}</td>
                          <td>{data.recommended}</td>
                          <td>{data.executed}</td>
                          <td>{data.recovered}</td>
                          <td>{percent(data.recoveryRate)}</td>
                          <td>{currency(data.averageRecoveredAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
          <aside className="detail-side">
            <section className="detail-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Evidence</span>
                  <h2>Provider-confirmed only</h2>
                </div>
              </div>
              <EvidenceNote>
                A recovery is only counted when Razorpay confirms it via a verified payment link event (RECOVERY_COMPLETED). Payment link creation alone does not count as recovery.
              </EvidenceNote>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function RecoveryBatch() {
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.batchStatus()
      .then((res) => setStatus(res.data))
      .catch((err) => setError(err.message));
  }, []);

  const runBatch = async () => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res = await api.runBatch(status?.maxBatchLimit || 20);
      setResult(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const summary = result?.summary;

  return (
    <>
      <PageHeader
        eyebrow="Operations / Batch"
        title="Recovery Batch"
        description="Process multiple recovery opportunities through recommendation, policy, and execution in one operation."
        action={
          <button
            className="primary-button"
            onClick={runBatch}
            disabled={running || !status}
          >
            {running ? (
              <>
                <span className="button-spinner" /> Processing...
              </>
            ) : (
              <>
                <Zap size={15} /> Run Batch
              </>
            )}
          </button>
        }
      />

      {error && <ErrorState message={error} />}

      {!status && !error && !result && <LoadingState text="Checking batch readiness" />}

      <EvidenceNote>
        A payment link being created is <strong>not</strong> recovered revenue. Recovery is counted only after provider confirmation via a verified Razorpay webhook (RECOVERY_COMPLETED).
      </EvidenceNote>

      {summary && (
        <div className="metrics-grid">
          <MetricCard
            icon={AlertTriangle}
            label="At Risk"
            value={number(summary.atRisk)}
            detail="Failed payment exposure"
            tone="amber"
          />
          <MetricCard
            icon={Clock3}
            label="Pending"
            value={number(summary.executionPending)}
            detail="Payment links created, awaiting customer payment"
            tone="cyan"
          />
          <MetricCard
            icon={CheckCircle2}
            label="Confirmed during batch"
            value={number(summary.confirmedRecoveries ?? 0)}
            detail="Provider-confirmed before this batch response"
            tone="green"
          />
          <MetricCard
            icon={ShieldCheck}
            label="Policy Blocked"
            value={number(summary.policyBlocked)}
            detail="Blocked by merchant policy or stopping rules"
            tone="danger"
          />
          <MetricCard
            icon={AlertIcon}
            label="Escalated"
            value={number(summary.escalated)}
            detail="Requires human review"
            tone="amber"
          />
          <MetricCard
            icon={Activity}
            label="Processed"
            value={number(summary.processed)}
            detail="Cases evaluated in this batch"
          />
        </div>
      )}

      {result?.results && (
        <section className="section-block">
          <SectionHeading
            eyebrow="Batch results"
            title="Per-case outcomes"
            action={<span className="muted" style={{ fontSize: '12px' }}>{result.results.length} cases</span>}
          />
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Status</th>
                  <th>Recommendation</th>
                  <th>Policy</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.caseId}>
                    <td className="mono">{r.caseId.slice(-8)}</td>
                    <td><StatusBadge value={r.status} /></td>
                    <td>{label(r.recommendation || '-')}</td>
                    <td>{r.policyDecision ? label(r.policyDecision) : '-'}</td>
                    <td className="muted">{r.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

export default App;