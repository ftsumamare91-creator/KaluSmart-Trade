
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "../lib/api";

type Member = {
  id: string;
  role: string;
  user: {
    id: string;
    email: string;
    fullName: string;
  };
};

type Notice = {
  kind: "ok" | "err";
  text: string;
};

const ROLES = ["ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"] as const;

type MemberRole = (typeof ROLES)[number];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "An unexpected error occurred. Please try again.";
}

export default function MembersPanel({
  currentUserId,
}: {
  currentUserId?: string;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await api<Member[]>("/users");
      setMembers(Array.isArray(result) ? result : []);
      setNotice(null);
    } catch (error: unknown) {
      setNotice({
        kind: "err",
        text: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (member: Member, selectedRole: string) => {
    if (selectedRole === member.role) return;

    if (!ROLES.includes(selectedRole as MemberRole)) {
      setNotice({
        kind: "err",
        text: "The selected role is not valid.",
      });
      return;
    }

    if (member.user.id === currentUserId) {
      setNotice({
        kind: "err",
        text: "You cannot change your own role.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Change ${member.user.email} from ${member.role} to ${selectedRole}?`,
    );

    if (!confirmed) return;

    setBusyId(member.user.id);
    setNotice(null);

    try {
      await api(`/users/${encodeURIComponent(member.user.id)}/role`, {
        method: "PATCH",
        body: { role: selectedRole },
      });

      setNotice({
        kind: "ok",
        text: `Role updated to ${selectedRole}.`,
      });

      await load(true);
    } catch (error: unknown) {
      setNotice({
        kind: "err",
        text: getErrorMessage(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (member: Member) => {
    if (member.user.id === currentUserId) {
      setNotice({
        kind: "err",
        text: "You cannot remove your own account.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Remove ${member.user.email} from this organization? Their sessions may be signed out.`,
    );

    if (!confirmed) return;

    setBusyId(member.user.id);
    setNotice(null);

    try {
      await api(`/users/${encodeURIComponent(member.user.id)}`, {
        method: "DELETE",
      });

      setNotice({
        kind: "ok",
        text: `${member.user.email} was removed successfully.`,
      });

      await load(true);
    } catch (error: unknown) {
      setNotice({
        kind: "err",
        text: getErrorMessage(error),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="panel members-panel" aria-labelledby="members-title">
      <div className="members-header">
        <div className="members-heading">
          <div className="members-icon" aria-hidden="true">
            <Users size={22} />
          </div>

          <div>
            <h2 id="members-title">
              Members &amp; roles · አባላት እና ሚናዎች
            </h2>

            <p className="demo-note">
              Manage organization access and member roles. You cannot change
              your own role. The organization must retain at least one
              administrator.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="button secondary members-refresh"
          onClick={() => void load(true)}
          disabled={loading || refreshing || busyId !== null}
          aria-label="Refresh members"
        >
          {refreshing ? (
            <Loader2 size={16} className="members-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          <span>Refresh</span>
        </button>
      </div>

      <div className="members-summary" aria-live="polite">
        <div className="members-summary-icon">
          <ShieldCheck size={19} />
        </div>
        <div>
          <strong>{members.length}</strong>
          <span>{members.length === 1 ? " member" : " members"}</span>
        </div>
      </div>

      {notice && (
        <div
          className={`members-notice ${
            notice.kind === "err" ? "members-notice-error" : "members-notice-success"
          }`}
          role={notice.kind === "err" ? "alert" : "status"}
        >
          {notice.kind === "err" ? (
            <AlertCircle size={18} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={18} aria-hidden="true" />
          )}

          <span>{notice.text}</span>
        </div>
      )}

      {loading ? (
        <div className="members-loading" role="status">
          <Loader2 size={24} className="members-spin" />
          <span>Loading members…</span>
        </div>
      ) : members.length === 0 ? (
        <div className="members-empty">
          <Users size={32} aria-hidden="true" />
          <h3>No members found</h3>
          <p>No members are currently available for this organization.</p>

          <button
            type="button"
            className="button secondary"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="members-table-wrap">
          <table className="members-table">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Email address</th>
                <th scope="col">Role</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>

            <tbody>
              {members.map((member) => {
                const isSelf =
                  currentUserId !== undefined &&
                  member.user.id === currentUserId;

                const isBusy = busyId === member.user.id;

                return (
                  <tr key={member.id}>
                    <td>
                      <div className="members-person">
                        <div className="members-avatar" aria-hidden="true">
                          {(member.user.fullName || member.user.email || "?")
                            .trim()
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div className="members-person-info">
                          <strong>
                            {member.user.fullName || "Unnamed member"}
                          </strong>

                          {isSelf && (
                            <span className="members-self-badge">
                              You · እርስዎ
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="members-email">{member.user.email}</td>

                    <td>
                      <div className="members-role-cell">
                        <select
                          className="members-role-select"
                          aria-label={`Role for ${member.user.email}`}
                          value={member.role}
                          disabled={isSelf || isBusy || busyId !== null}
                          onChange={(event) =>
                            void changeRole(member, event.target.value)
                          }
                        >
                          {!ROLES.includes(member.role as MemberRole) && (
                            <option value={member.role}>
                              {member.role}
                            </option>
                          )}

                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>

                        {isBusy && (
                          <Loader2
                            size={16}
                            className="members-spin"
                            aria-label="Updating member"
                          />
                        )}
                      </div>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="button secondary members-remove"
                        disabled={isSelf || busyId !== null}
                        onClick={() => void removeMember(member)}
                        aria-label={`Remove ${member.user.email}`}
                        title={
                          isSelf
                            ? "You cannot remove your own account"
                            : "Remove member"
                        }
                      >
                        {isBusy ? (
                          <Loader2
                            size={16}
                            className="members-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Trash2 size={16} aria-hidden="true" />
                        )}

                        <span>{isSelf ? "You" : "Remove"}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .members-panel {
          min-width: 0;
          overflow: hidden;
        }

        .members-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }

        .members-heading {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          flex: 1;
          min-width: 240px;
        }

        .members-icon,
        .members-summary-icon {
          display: grid;
          place-items: center;
          flex-shrink: 0;
          color: #0ea5e9;
          background: rgba(14, 165, 233, 0.12);
          border: 1px solid rgba(14, 165, 233, 0.2);
          border-radius: 12px;
        }

        .members-icon {
          width: 46px;
          height: 46px;
        }

        .members-heading h2 {
          margin: 0 0 8px;
          line-height: 1.45;
        }

        .members-heading .demo-note {
          margin: 0;
          line-height: 1.65;
          color: var(--muted, #64748b);
        }

        .members-refresh {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 40px;
        }

        .members-summary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin: 20px 0 14px;
          padding: 9px 14px;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
        }

        .members-summary-icon {
          width: 34px;
          height: 34px;
          border-radius: 9px;
        }

        .members-summary strong {
          font-size: 1.05rem;
          font-variant-numeric: tabular-nums;
        }

        .members-summary span {
          color: var(--muted, #64748b);
          font-size: 0.9rem;
        }

        .members-notice {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 0 0 16px;
          padding: 12px 14px;
          border: 1px solid;
          border-radius: 10px;
          overflow-wrap: anywhere;
        }

        .members-notice svg {
          flex-shrink: 0;
          margin-top: 2px;
        }

        .members-notice-error {
          color: #b91c1c;
          background: #fef2f2;
          border-color: #fecaca;
        }

        .members-notice-success {
          color: #166534;
          background: #f0fdf4;
          border-color: #bbf7d0;
        }

        .members-loading,
        .members-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 12px;
          min-height: 180px;
          padding: 24px;
          color: var(--muted, #64748b);
          text-align: center;
        }

        .members-empty h3,
        .members-empty p {
          margin: 0;
        }

        .members-empty h3 {
          color: var(--foreground, #0f172a);
        }

        .members-table-wrap {
          width: 100%;
          overflow-x: auto;
          border: 1px solid var(--border, #e2e8f0);
          border-radius: 12px;
        }

        .members-table {
          width: 100%;
          min-width: 650px;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }

        .members-table th,
        .members-table td {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border, #e2e8f0);
          vertical-align: middle;
        }

        .members-table th {
          color: var(--muted, #64748b);
          background: var(--surface-muted, #f8fafc);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.035em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .members-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .members-table tbody tr {
          transition: background 160ms ease;
        }

        .members-table tbody tr:hover {
          background: rgba(14, 165, 233, 0.045);
        }

        .members-person {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 150px;
        }

        .members-avatar {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border: 1px solid rgba(14, 165, 233, 0.2);
          border-radius: 12px;
          color: #0369a1;
          background: rgba(14, 165, 233, 0.1);
          font-weight: 800;
        }

        .members-person-info {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .members-person-info strong {
          overflow-wrap: anywhere;
        }

        .members-self-badge {
          width: fit-content;
          padding: 2px 7px;
          border-radius: 999px;
          color: #0369a1;
          background: rgba(14, 165, 233, 0.12);
          font-size: 0.72rem;
          font-weight: 700;
        }

        .members-email {
          overflow-wrap: anywhere;
        }

        .members-role-cell {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .members-role-select {
          width: 100%;
          min-width: 130px;
          min-height: 38px;
          padding: 7px 30px 7px 10px;
          border: 1px solid var(--border, #cbd5e1);
          border-radius: 8px;
          color: inherit;
          background: var(--input-bg, transparent);
          font: inherit;
        }

        .members-role-select:focus-visible,
        .members-refresh:focus-visible,
        .members-remove:focus-visible {
          outline: 2px solid #0ea5e9;
          outline-offset: 3px;
        }

        .members-role-select:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }

        .members-remove {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 36px;
          white-space: nowrap;
        }

        .members-remove:not(:disabled) {
          color: #dc2626;
        }

        .members-remove:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .members-spin {
          animation: members-spin 1s linear infinite;
        }

        @keyframes members-spin {
          to {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 640px) {
          .members-header {
            align-items: stretch;
          }

          .members-heading {
            min-width: 0;
          }

          .members-refresh {
            align-self: flex-start;
          }

          .members-table th,
          .members-table td {
            padding: 11px 12px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .members-spin {
            animation-duration: 2s;
          }

          .members-table tbody tr {
            transition: none;
          }
        }

        :global(html.dark) .members-notice-error {
          color: #fecaca;
          background: rgba(127, 29, 29, 0.25);
          border-color: rgba(248, 113, 113, 0.3);
        }

        :global(html.dark) .members-notice-success {
          color: #bbf7d0;
          background: rgba(20, 83, 45, 0.25);
          border-color: rgba(74, 222, 128, 0.3);
        }

        :global(html.dark) .members-table th {
          background: rgba(15, 23, 42, 0.65);
        }

        :global(html.dark) .members-avatar {
          color: #7dd3fc;
        }

        :global(html.dark) .members-empty h3 {
          color: #e2e8f0;
        }
      `}</style>
    </section>
  );
}
