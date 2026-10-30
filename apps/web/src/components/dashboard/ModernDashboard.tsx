
"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  Download,
  LayoutDashboard,
  Menu,
  Package,
  Search,
  Settings,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
  X,
  Clock3,
  FileText,
  AlertCircle,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import styles from "./dashboard.module.css";

export type MetricIcon =
  | "sales"
  | "collections"
  | "expenses"
  | "inventory";

export type DashboardMetric = {
  label: string;
  value: number | null;
  description: string;
  icon: MetricIcon;
  change?: number | null;
};

export type SalesPoint = {
  date: string;
  sales: number;
  collections?: number;
};

export type InventoryPoint = {
  name: string;
  quantity: number;
  value?: number;
};

export type DashboardTransaction = {
  id: string;
  reference: string;
  customer: string;
  date: string;
  type: string;
  amount: number;
  status: "Completed" | "Pending" | "Rejected" | "Paid";
};

export type DashboardData = {
  metrics: DashboardMetric[];
  sales: SalesPoint[];
  inventory: InventoryPoint[];
  transactions: DashboardTransaction[];
};

type ModernDashboardProps = {
  companyName: string;
  currency?: string;
  data: DashboardData;
};

const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Sales", icon: ShoppingCart },
  { label: "Inventory", icon: Boxes },
  { label: "Customers", icon: Users },
  { label: "Payments", icon: CreditCard },
  { label: "Expenses", icon: Wallet },
  { label: "Reports", icon: FileText },
];

const metricIcons = {
  sales: CircleDollarSign,
  collections: Wallet,
  expenses: ArrowDownRight,
  inventory: Package,
};

function formatMoney(
  value: number | null | undefined,
  currency: string,
) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-ET", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return new Intl.NumberFormat("en-ET", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value || "—";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <Activity size={22} />
      </div>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyDescription}>{description}</p>
    </div>
  );
}

export default function ModernDashboard({
  companyName,
  currency = "ETB",
  data,
}: ModernDashboardProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("7 days");
  const [activeNav, setActiveNav] = useState("Overview");
  const [notice, setNotice] = useState("");

  const metrics = data?.metrics ?? [];
  const sales = data?.sales ?? [];
  const inventory = data?.inventory ?? [];
  const transactions = data?.transactions ?? [];

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return transactions;

    return transactions.filter((item) =>
      [
        item.id,
        item.reference,
        item.customer,
        item.type,
        item.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [transactions, search]);

  const totalSales = useMemo(
    () => sales.reduce((sum, item) => sum + (item.sales || 0), 0),
    [sales],
  );

  const totalCollections = useMemo(
    () =>
      sales.reduce((sum, item) => sum + (item.collections || 0), 0),
    [sales],
  );

  function handleExport() {
    if (transactions.length === 0) {
      setNotice("There are no transactions to export yet.");
      return;
    }

    const headers = [
      "Reference",
      "Customer",
      "Date",
      "Type",
      "Amount",
      "Status",
    ];

    const rows = transactions.map((item) => [
      item.reference,
      item.customer,
      item.date,
      item.type,
      String(item.amount),
      item.status,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "kalu-dashboard-transactions.csv";
    link.click();

    URL.revokeObjectURL(url);
    setNotice("Transaction CSV exported.");
  }

  return (
    <main className={styles.dashboard}>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className={styles.mobileBackdrop}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`${styles.sidebar} ${
          sidebarOpen ? styles.sidebarOpen : ""
        }`}
      >
        <div className={styles.brand}>
          <div className={styles.brandMark}>
            <BriefcaseBusiness size={23} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>TIBEB AI</span>
            <span className={styles.brandCaption}>BUSINESS INTELLIGENCE</span>
          </div>
          <button
            type="button"
            className={styles.closeSidebar}
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.workspaceLabel}>WORKSPACE</div>

        <nav className={styles.navigation} aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.label;

            return (
              <button
                type="button"
                key={item.label}
                className={`${styles.navItem} ${
                  active ? styles.navItemActive : ""
                }`}
                onClick={() => {
                  setActiveNav(item.label);
                  setSidebarOpen(false);

                  if (item.label !== "Overview") {
                    setNotice(
                      `${item.label} navigation is a preview. Connect it to the corresponding application route.`,
                    );
                  } else {
                    setNotice("");
                  }
                }}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{item.label}</span>
                {active && <span className={styles.activeDot} />}
              </button>
            );
          })}
        </nav>

        <div className={styles.sidebarSpacer} />

        <div className={styles.sidebarHelp}>
          <div className={styles.helpOrb}>
            <Activity size={19} />
          </div>
          <p className={styles.helpTitle}>Business at a glance</p>
          <p className={styles.helpText}>
            Review sales, collections, and stock from one workspace.
          </p>
        </div>

        <button
          type="button"
          className={styles.navItem}
          onClick={() =>
            setNotice("Settings preview: connect this to your settings route.")
          }
        >
          <Settings size={19} strokeWidth={1.8} />
          <span>Settings</span>
        </button>

        <div className={styles.sidebarFooter}>
          <div className={styles.avatar}>KT</div>
          <div className={styles.profileText}>
            <span className={styles.profileName}>Kalu Trading</span>
            <span className={styles.profileRole}>Business workspace</span>
          </div>
          <ChevronDown size={16} className={styles.profileChevron} />
        </div>
      </aside>

      <section className={styles.mainPanel}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              aria-label="Open navigation"
              className={styles.menuButton}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={22} />
            </button>

            <div className={styles.breadcrumb}>
              <span>Workspace</span>
              <span className={styles.breadcrumbSlash}>/</span>
              <strong>{activeNav}</strong>
            </div>
          </div>

          <div className={styles.topbarActions}>
            <label className={styles.searchBox}>
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search transactions..."
                aria-label="Search transactions"
              />
              <kbd>⌘ K</kbd>
            </label>

            <button
              type="button"
              className={styles.iconButton}
              aria-label="Notifications"
              onClick={() =>
                setNotice("You are all caught up in this preview.")
              }
            >
              <Bell size={19} />
              <span className={styles.notificationDot} />
            </button>

            <div className={styles.topbarDivider} />

            <div className={styles.userAvatar}>KT</div>
          </div>
        </header>

        <div className={styles.content}>
          <div className={styles.pageHeading}>
            <div>
              <div className={styles.eyebrow}>
                <span className={styles.eyebrowLine} />
                BUSINESS OVERVIEW
              </div>
              <h1>Good business starts with <span>clarity.</span></h1>
              <p className={styles.pageSubtitle}>
                Welcome to {companyName}. Here is your business snapshot.
              </p>
            </div>

            <div className={styles.headingActions}>
              <div className={styles.periodSelect}>
                <CalendarDays size={16} />
                <select
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  aria-label="Dashboard period"
                >
                  <option>7 days</option>
                  <option>30 days</option>
                  <option>90 days</option>
                  <option>This year</option>
                </select>
                <ChevronDown size={14} />
              </div>

              <button
                type="button"
                className={styles.exportButton}
                onClick={handleExport}
              >
                <Download size={16} />
                Export
              </button>
            </div>
          </div>

          {notice && (
            <div className={styles.notice} role="status">
              <AlertCircle size={17} />
              <span>{notice}</span>
              <button
                type="button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div className={styles.sectionHeading}>
            <div>
              <h2>Performance overview</h2>
              <p>Your key business indicators in one place.</p>
            </div>
            <span className={styles.liveBadge}>
              <span />
              Dashboard preview
            </span>
          </div>

          <div className={styles.metricsGrid}>
            {metrics.map((metric, index) => {
              const Icon = metricIcons[metric.icon] ?? CircleDollarSign;
              const hasChange =
                metric.change !== null && metric.change !== undefined;

              return (
                <article
                  className={`${styles.metricCard} ${styles[`metricCard${index + 1}`] ?? ""}`}
                  key={`${metric.label}-${index}`}
                >
                  <div className={styles.metricTop}>
                    <div className={styles.metricIcon}>
                      <Icon size={21} strokeWidth={1.8} />
                    </div>
                    {hasChange && (
                      <span
                        className={
                          metric.change! >= 0
                            ? styles.changePositive
                            : styles.changeNegative
                        }
                      >
                        {metric.change! >= 0 ? (
                          <ArrowUpRight size={14} />
                        ) : (
                          <ArrowDownRight size={14} />
                        )}
                        {Math.abs(metric.change!)}%
                      </span>
                    )}
                  </div>

                  <p className={styles.metricLabel}>{metric.label}</p>
                  <div className={styles.metricValue}>
                    {formatMoney(metric.value, currency)}
                  </div>
                  <div className={styles.metricBottom}>
                    <span>{metric.description}</span>
                    <TrendingUp size={15} />
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.analyticsGrid}>
            <section className={`${styles.panel} ${styles.salesPanel}`}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.panelTitleRow}>
                    <h2>Sales performance</h2>
                    <span className={styles.panelIcon}>
                      <Activity size={16} />
                    </span>
                  </div>
                  <p>Sales and collections over the selected period.</p>
                </div>

                <div className={styles.chartLegend}>
                  <span>
                    <i className={styles.legendSales} /> Sales
                  </span>
                  <span>
                    <i className={styles.legendCollections} /> Collections
                  </span>
                </div>
              </div>

              <div className={styles.chartSummary}>
                <div>
                  <span className={styles.summaryLabel}>Recorded sales</span>
                  <strong>{formatMoney(totalSales, currency)}</strong>
                </div>
                <div>
                  <span className={styles.summaryLabel}>Collections</span>
                  <strong>{formatMoney(totalCollections, currency)}</strong>
                </div>
              </div>

              {sales.length > 0 ? (
                <div className={styles.chartArea}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={sales}
                      margin={{ top: 10, right: 8, left: -12, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="salesGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#27c6d9"
                            stopOpacity={0.25}
                          />
                          <stop
                            offset="95%"
                            stopColor="#27c6d9"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="#243247"
                        strokeDasharray="3 5"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#8190a7", fontSize: 11 }}
                        tickFormatter={(value: string) => {
                          const date = new Date(value);
                          return Number.isNaN(date.getTime())
                            ? value
                            : date.toLocaleDateString("en", {
                                month: "short",
                                day: "numeric",
                              });
                        }}
                        dy={10}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "#8190a7", fontSize: 11 }}
                        tickFormatter={(value: number) =>
                          value >= 1000
                            ? `${(value / 1000).toFixed(1)}k`
                            : String(value)
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#101b2c",
                          border: "1px solid #293950",
                          borderRadius: 12,
                          color: "#f3f7ff",
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "#9eacc2" }}
                        formatter={(value) => [
                          formatMoney(Number(value), currency),
                          "",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="sales"
                        name="Sales"
                        stroke="#27c6d9"
                        strokeWidth={2.5}
                        fill="url(#salesGradient)"
                        activeDot={{ r: 5, fill: "#27c6d9" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="collections"
                        name="Collections"
                        stroke="#9b8cff"
                        strokeWidth={2.2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  title="No sales data yet"
                  description={`Sales data for the selected period (${period}) will appear here when connected.`}
                />
              )}
            </section>

            <section className={`${styles.panel} ${styles.inventoryPanel}`}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.panelTitleRow}>
                    <h2>Inventory snapshot</h2>
                    <span className={styles.panelIconPurple}>
                      <Boxes size={16} />
                    </span>
                  </div>
                  <p>Items currently included in this report.</p>
                </div>
                <button
                  type="button"
                  className={styles.moreButton}
                  aria-label="Inventory information"
                  onClick={() =>
                    setNotice("Inventory values are supplied by the dashboard data.")
                  }
                >
                  •••
                </button>
              </div>

              {inventory.length > 0 ? (
                <div className={styles.inventoryList}>
                  {inventory.slice(0, 5).map((item, index) => {
                    const maxQuantity = Math.max(
                      ...inventory.map((entry) => entry.quantity),
                      1,
                    );
                    const width = Math.max(
                      4,
                      Math.min(100, (item.quantity / maxQuantity) * 100),
                    );

                    return (
                      <div
                        className={styles.inventoryItem}
                        key={`${item.name}-${index}`}
                      >
                        <div className={styles.inventoryItemTop}>
                          <div className={styles.inventoryItemName}>
                            <span className={styles.inventoryBullet} />
                            <span>{item.name}</span>
                          </div>
                          <strong>{formatNumber(item.quantity)}</strong>
                        </div>
                        <div className={styles.inventoryTrack}>
                          <span style={{ width: `${width}%` }} />
                        </div>
                        {item.value !== undefined && (
                          <div className={styles.inventoryValue}>
                            Stock value: {formatMoney(item.value, currency)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="Inventory will appear here"
                  description="Connect inventory data to see item quantities and stock values."
                />
              )}

              <div className={styles.inventoryFooter}>
                <div className={styles.inventoryFooterIcon}>
                  <Package size={17} />
                </div>
                <div>
                  <strong>{inventory.length}</strong>
                  <span> inventory categories/items in this dataset</span>
                </div>
              </div>
            </section>
          </div>

          <section className={`${styles.panel} ${styles.transactionsPanel}`}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.panelTitleRow}>
                  <h2>Recent transactions</h2>
                  <span className={styles.transactionCount}>
                    {filteredTransactions.length}
                  </span>
                </div>
                <p>Search and review transactions included in this dataset.</p>
              </div>

              <button
                type="button"
                className={styles.viewAllButton}
                onClick={() =>
                  setNotice(
                    "Full transaction history requires connecting the Sales API route.",
                  )
                }
              >
                View all <ArrowUpRight size={15} />
              </button>
            </div>

            {filteredTransactions.length > 0 ? (
              <div className={styles.tableWrap}>
                <table className={styles.transactionsTable}>
                  <thead>
                    <tr>
                      <th>REFERENCE</th>
                      <th>CUSTOMER</th>
                      <th>DATE</th>
                      <th>TYPE</th>
                      <th>AMOUNT</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <span className={styles.referenceCell}>
                            <span className={styles.referenceIcon}>
                              <FileText size={15} />
                            </span>
                            {item.reference}
                          </span>
                        </td>
                        <td>{item.customer}</td>
                        <td>{formatDate(item.date)}</td>
                        <td>{item.type}</td>
                        <td className={styles.amountCell}>
                          {formatMoney(item.amount, currency)}
                        </td>
                        <td>
                          <span
                            className={`${styles.statusBadge} ${
                              item.status === "Completed" ||
                              item.status === "Paid"
                                ? styles.statusSuccess
                                : item.status === "Pending"
                                  ? styles.statusPending
                                  : styles.statusRejected
                            }`}
                          >
                            {item.status === "Completed" ||
                            item.status === "Paid" ? (
                              <CheckCircle2 size={13} />
                            ) : item.status === "Pending" ? (
                              <Clock3 size={13} />
                            ) : (
                              <AlertCircle size={13} />
                            )}
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title={
                  search
                    ? "No matching transactions"
                    : "No transactions recorded"
                }
                description={
                  search
                    ? "Try a different search term."
                    : "Transactions will appear here when data is supplied by your application."
                }
              />
            )}

            <div className={styles.tableFooter}>
              <span>
                Showing {filteredTransactions.length} of {transactions.length}{" "}
                transactions
              </span>
              <span className={styles.tableFooterNote}>
                <span /> Data provided to this preview
              </span>
            </div>
          </section>

          <footer className={styles.footer}>
            <span>© {new Date().getFullYear()} {companyName}</span>
            <span className={styles.footerCenter}>
              <span /> TIBEB AI BUSINESS WORKSPACE
            </span>
            <span>Built for better business visibility</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
