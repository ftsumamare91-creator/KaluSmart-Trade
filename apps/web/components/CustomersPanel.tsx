
"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { canDeleteCustomers, canWriteOps } from "../lib/nav-access";

type Customer = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
};

export default function CustomersPanel({ role }: { role?: string }) {
  const [items, setItems] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    setNotice("");

    try {
      const search = q.trim();
      const result = await api<Customer[]>(
        `/customers?take=100${search ? `&q=${encodeURIComponent(search)}` : ""}`
      );

      setItems(result);
    } catch (error) {
      setErr(
        error instanceof Error
          ? error.message
          : "Failed to load customers. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Keep the form reference before awaiting the API request.
    const form = e.currentTarget;
    const formData = new FormData(form);

    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();

    if (name.length < 2) {
      setErr("Customer name must contain at least 2 characters.");
      return;
    }

    setSaving(true);
    setErr("");
    setNotice("");

    try {
      await api("/customers", {
        body: {
          name,
          email: email || undefined,
          phone: phone || undefined,
        },
      });

      form.reset();
      setNotice("Customer added successfully.");

      // Reload the customer list after saving.
      await load();
      setNotice("Customer added successfully.");
    } catch (error) {
      setErr(
        error instanceof Error
          ? error.message
          : "Could not save customer. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!canDeleteCustomers(role)) {
      setErr("You do not have permission to delete customers.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to delete this customer?"
    );

    if (!confirmed) return;

    setDeletingId(id);
    setErr("");
    setNotice("");

    try {
      await api(`/customers/${id}`, { method: "DELETE" });

      setItems((current) => current.filter((customer) => customer.id !== id));
      setNotice("Customer deleted successfully.");

      // Refresh from the server to keep the list synchronized.
      await load();
    } catch (error) {
      setErr(
        error instanceof Error
          ? error.message
          : "Could not delete customer. Please try again."
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid-two">
      {/* Customer list */}
      <section className="panel">
        <div
          className="panel-head"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2>Customers</h2>
            <p>ደንበኞች · search and manage</p>
          </div>

          <button
            type="button"
            className="button secondary"
            onClick={() => void load()}
            disabled={loading}
            title="Refresh customer list"
            aria-label="Refresh customer list"
          >
            {loading ? "Loading..." : "↻ Refresh"}
          </button>
        </div>

        <input
          className="form-input"
          placeholder="Search name or email..."
          value={q}
          onChange={(event) => setQ(event.target.value)}
          aria-label="Search customers by name or email"
          style={{ margin: "14px 0" }}
        />

        {err && (
          <p className="error-msg" role="alert">
            {err}
          </p>
        )}

        {notice && (
          <p role="status" style={{ color: "#16a34a", margin: "10px 0" }}>
            {notice}
          </p>
        )}

        {loading ? (
          <p role="status">Loading customers...</p>
        ) : items.length === 0 ? (
          <p className="demo-note">
            {q.trim()
              ? "No customers match your search."
              : "No customers yet."}
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  {canDeleteCustomers(role) && <th scope="col">Actions</th>}
                </tr>
              </thead>

              <tbody>
                {items.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.name}</td>
                    <td>{customer.email || "—"}</td>
                    <td>{customer.phone || "—"}</td>

                    {canDeleteCustomers(role) && (
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => void remove(customer.id)}
                          disabled={deletingId !== null}
                          aria-label={`Delete ${customer.name}`}
                        >
                          {deletingId === customer.id
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p
          className="demo-note"
          style={{ marginTop: 12 }}
          aria-live="polite"
        >
          {items.length} customer{items.length === 1 ? "" : "s"} displayed
          {q.trim() ? " matching your search" : ""}.
        </p>
      </section>

      {/* Add customer form */}
      {canWriteOps(role) && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Add customer</h2>
              <p>አዲስ ደንበኛ</p>
            </div>
          </div>

          <form onSubmit={add} style={{ marginTop: 14 }}>
            <div className="form-row">
              <label htmlFor="customer-name">Name · ስም</label>
              <input
                id="customer-name"
                className="form-input"
                name="name"
                type="text"
                placeholder="Enter customer name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                disabled={saving}
              />
            </div>

            <div className="form-row">
              <label htmlFor="customer-email">Email</label>
              <input
                id="customer-email"
                className="form-input"
                name="email"
                type="email"
                placeholder="customer@example.com"
                autoComplete="email"
                maxLength={254}
                disabled={saving}
              />
            </div>

            <div className="form-row">
              <label htmlFor="customer-phone">Phone · ስልክ</label>
              <input
                id="customer-phone"
                className="form-input"
                name="phone"
                type="tel"
                placeholder="Enter phone number"
                autoComplete="tel"
                maxLength={30}
                disabled={saving}
              />
            </div>

            <button
              className="button primary"
              type="submit"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save customer"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

