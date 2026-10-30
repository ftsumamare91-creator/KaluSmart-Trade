import ModernDashboard, {
  type DashboardData,
} from "@/components/dashboard/ModernDashboard";

const emptyDashboardData: DashboardData = {
  metrics: [
    {
      label: "Sales",
      value: null,
      description: "Recorded sales",
      icon: "sales",
      change: null,
    },
    {
      label: "Collections",
      value: null,
      description: "Payments received",
      icon: "collections",
      change: null,
    },
    {
      label: "Operating expenses",
      value: null,
      description: "Recorded expenses",
      icon: "expenses",
      change: null,
    },
    {
      label: "Inventory purchases",
      value: null,
      description: "Stock purchases",
      icon: "inventory",
      change: null,
    },
  ],
  sales: [],
  inventory: [],
  transactions: [],
};

export default function DashboardPreviewPage() {
  return (
    <ModernDashboard
      companyName="Kalu Trading PLC"
      currency="ETB"
      data={emptyDashboardData}
    />
  );
}
