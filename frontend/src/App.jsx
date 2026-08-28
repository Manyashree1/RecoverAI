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
  ClipboardList,
  FileSearch,
  Filter,
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

  useEffect(() => {
    const onUnauthorized = () => setSession(false);

    window.addEventListener('recoverai:unauthorized', onUnauthorized);

    return () => {
      window.removeEventListener('recoverai:unauthorized', onUnauthorized);
    };
  }, []);

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
          />
        }
      >
        <Route path="/" element={<Overview />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/payments/:id" element={<PaymentDetail />} />
        <Route path="/recovery-cases" element={<RecoveryCases />} />
        <Route path="/recovery-cases/:id" element={<CaseDetail />} />
        <Route path="/recovery-actions" element={<Actions />} />
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

function Shell({ onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = getUser();

  const links = [
    ['/', 'Overview', BarChart3],
    ['/payments', 'Payments', Receipt],
    ['/recovery-cases', 'Recovery Cases', RefreshCw],
    ['/recovery-actions', 'Recovery Actions', Zap],
    ['/audit', 'Audit Trail', FileSearch],
  ];

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
          detail="Confirmed by provider evidence"
          tone="green"
        />

        <MetricCard
          icon={BarChart3}
          label="Recovery rate"
          value={percent(overview.recoveryRate)}
          detail="Cases recovered / at risk"
          tone="green"
        />

        <MetricCard
          icon={ShieldCheck}
          label="Successful recoveries"
          value={number(overview.successfulRecoveries)}
          detail="With confirmed payment"
          tone="green"
        />

        <MetricCard
          icon={AlertIcon}
          label="Escalated to humans"
          value={number(overview.escalatedCases)}
          detail={overview.escalatedAmount ? currency(overview.escalatedAmount) : 'No escalations'}
          tone="amber"
        />

        <MetricCard
          icon={LockIcon}
          label="Stopped by policy"
          value={number(overview.stoppedActions || overview.blockedActions)}
          detail={overview.blockedAmount ? currency(overview.blockedAmount) : 'Safety rules applied'}
          tone="cyan"
        />

        <MetricCard
          icon={Activity}
          label="Recovery attempts"
          value={number(overview.recoveryAttempts)}
          detail="Actions executed"
        />
      </div>

      {overview.funnel && (
        <section className="section-block">
          <SectionHeading
            eyebrow="Recovery funnel"
            title="From detection to recovery"
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
        actions, and audit events. Link creation is not counted as recovered
        revenue.
      </EvidenceNote>
    </>
  );
}

function GaugeIcon(props) {
  return <Activity {...props} />;
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

function ChevronIcon() {
  return <ArrowUpRight size={17} className="row-arrow" />;
}

function RecoveryCases() {
  const [status, setStatus] = useState('OPEN');

  const {
    loading,
    error,
    data,
    reload,
  } = useRequest(
    () =>
      api.cases({
        limit: 100,
        ...(status ? { status } : {}),
      }),
    [status]
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

  const caseRequest = useRequest(
    () => api.case(id),
    [id]
  );

  const item = caseRequest.data?.data;

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
                The original payment failed. The recovery outcome
                below is a separate customer payment, confirmed
                independently by Razorpay.
              </EvidenceNote>
            )}
          </section>

          <section className="detail-panel journey-panel">
            <div className="panel-label">
              <Activity size={15} /> Recovery journey
            </div>

            <div className="state-rail horizontal">
              <StateRail active={item.status} />
            </div>
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
                      Razorpay TEST webhook verified this
                      recovery via a signed payment link event
                      (RECOVERY_COMPLETED).
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
            return (
              <section className="detail-panel escalation-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Escalation</span>
                    <h2>Automation stopped safely</h2>
                  </div>
                  <AlertIcon />
                </div>
                <div className="escalation-summary">
                  <p>
                    <strong>Automation stopped.</strong> {escalationAction.policyDecision?.reason || 'Maximum automated attempts reached.'}
                  </p>
                  <div className="escalation-meta">
                    <span>
                      Reason <b>{escalationAction.policyDecision?.reason || 'Exhausted automated channels'}</b>
                    </span>
                    <span>
                      Escalated at <b>{dateTime(escalationAction.createdAt)}</b>
                    </span>
                    <span>
                      Status <StatusBadge value="ESCALATED" />
                    </span>
                  </div>
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
                    Other policy decisions
                  </span>

                  <h2>
                    {secondaryActions.length} additional
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

          <section className="detail-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">AI analysis</span>
                <h2>
                  Recommendation &amp; policy decision
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
                      {recommendation.source ||
                        recommendation.recoveryAction
                          ?.recommendation?.source ||
                        'System fallback'}
                    </b>
                  </span>
                </div>

                {actionStatus && (
                  <div className="execution-status">
                    <span className="field-label">
                      Recovery action status
                    </span>

                    <StatusBadge value={actionStatus} />
                  </div>
                )}

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
              Recoveries are reflected as historical completed
              actions, and a recovered case cannot generate a
              new actionable recommendation.
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
                      {recommendation.source ||
                        recommendation.recoveryAction
                          ?.recommendation?.source ||
                        'System fallback'}
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
              <StateRail active={item.status} />
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

function StateRail({ active }) {
  const states = [
    'DETECTED',
    'DIAGNOSED',
    'RECOMMENDED',
    'POLICY_ALLOWED',
    'ACTION_PENDING',
    'RECOVERED',
  ];

  const index = states.indexOf(active);

  return (
    <>
      {states.map((state, current) => (
        <div
          className={`state-step ${
            current <= index ? 'done' : ''
          } ${state === active ? 'current' : ''}`}
          key={state}
        >
          <span>
            {current < index ? '✓' : current + 1}
          </span>

          <strong>{label(state)}</strong>
        </div>
      ))}
    </>
  );
}

function Timeline({ events }) {
  return (
    <div className="timeline">
      {[...events].reverse().map((event) => (
        <div
          className="timeline-item"
          key={
            event.id ||
            `${event.type}-${event.createdAt}`
          }
        >
          <span className="timeline-dot" />

          <div>
            <div className="timeline-meta">
              <strong>{label(event.type)}</strong>
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
          </div>
        </div>
      ))}
    </div>
  );
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
        description="A read-only ledger of what RecoverAI recommended, blocked, or executed."
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
      ) : (
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
                <tr key={itemAction.id}>
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

                  <td>
                    {itemAction.policyDecision
                      ?.decision ? (
                      <StatusBadge
                        value={
                          itemAction.policyDecision
                            .decision
                        }
                      />
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
                        <span className="history-evidence paid">
                          <CheckCircle2 size={13} /> Paid
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
                    ) : itemAction.policyDecision
                        ?.decision === 'BLOCKED' ? (
                      <span className="history-evidence pending">
                        {itemAction.policyDecision.reason ||
                          'Blocked by policy'}
                      </span>
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

function Audit() {
  const location = useLocation();

  const params = new URLSearchParams(
    location.search
  );

  const [type, setType] = useState('');
  const [query, setQuery] = useState(
    params.get('recoveryCase') || ''
  );

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

  const filtered = events.filter(
    (event) => !type || event.type === type
  );

  const eventTypes = [
    ...new Set(events.map((event) => event.type)),
  ];

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
      </div>

      {loading ? (
        <LoadingState text="Loading audit events" />
      ) : error ? (
        <ErrorState message={error} />
      ) : filtered.length ? (
        <div className="audit-list">
          <Timeline events={filtered} />
        </div>
      ) : (
        <EmptyState
          icon={FileSearch}
          title="No audit events found"
          text="Try another event type or recovery case ID."
        />
      )}
    </>
  );
}

export default App;