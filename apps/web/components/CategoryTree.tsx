"use client";

import { FormEvent, ReactNode, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Category, Msg, catName, slugify } from "../lib/categories";
import type { Lang } from "../lib/i18n";
import { CT } from "../lib/catalog-i18n";

type Props = {
  lang: Lang;
  tree: Category[];
  canWrite: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  onMessage: (m: Msg) => void;
};

type AddDraft = {
  parentId: string | null;
  nameAm: string;
  nameEn: string;
  nameOm: string;
  nameTi: string;
  slug: string;
  slugTouched: boolean;
};

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Unexpected error");

/** Hides disabled categories (and their subtrees) unless the user chose to see them. */
function visibleNodes(nodes: Category[], showInactive: boolean): Category[] {
  return nodes
    .filter((n) => showInactive || n.isActive)
    .map((n) => ({ ...n, children: visibleNodes(n.children ?? [], showInactive) }));
}

export default function CategoryTree({ lang, tree, canWrite, selectedId, onSelect, onChanged, onMessage }: Props) {
  const t = CT[lang];
  const [showInactive, setShowInactive] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<AddDraft | null>(null);
  const [busy, setBusy] = useState(false);

  const nodes = visibleNodes(tree, showInactive);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAdd(parentId: string | null) {
    setDraft({ parentId, nameAm: "", nameEn: "", nameOm: "", nameTi: "", slug: "", slugTouched: false });
  }

  async function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const nameAm = draft.nameAm.trim();
    const slug = draft.slug.trim();
    if (!nameAm || !slug) {
      onMessage({ kind: "err", text: t.required });
      return;
    }
    setBusy(true);
    try {
      await api("/categories", {
        body: {
          nameAm,
          nameEn: draft.nameEn.trim() || undefined,
          nameOm: draft.nameOm.trim() || undefined,
          nameTi: draft.nameTi.trim() || undefined,
          slug,
          parentId: draft.parentId ?? undefined,
        },
      });
      setDraft(null);
      onMessage({ kind: "ok", text: t.created });
      onChanged();
    } catch (e) {
      onMessage({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function setActive(node: Category, isActive: boolean) {
    setBusy(true);
    try {
      await api(`/categories/${node.id}/${isActive ? "enable" : "disable"}`, { method: "POST" });
      onMessage({ kind: "ok", text: isActive ? t.enabledDone : t.disabledDone });
      onChanged();
    } catch (e) {
      onMessage({ kind: "err", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  function renderNode(node: Category, depth: number): ReactNode {
    const hasKids = (node.children ?? []).length > 0;
    const isCollapsed = collapsed.has(node.id);
    const selected = selectedId === node.id;

    return (
      <div key={node.id}>
        <div
          className={`cat-row${selected ? " selected" : ""}${node.isActive ? "" : " inactive"}`}
          style={{ paddingLeft: 6 + depth * 18 }}
        >
          <button
            type="button"
            className="cat-toggle"
            disabled={!hasKids}
            onClick={() => toggleCollapsed(node.id)}
            aria-label={isCollapsed ? "expand" : "collapse"}
          >
            {hasKids ? (isCollapsed ? "▸" : "▾") : "·"}
          </button>

          <button type="button" className="cat-label" onClick={() => onSelect(selected ? null : node.id)}>
            {catName(node, lang)}
            {!node.isActive && <small className="cat-tag"> ({t.disabled})</small>}
          </button>

          {canWrite && (
            <span className="cat-actions">
              <button type="button" disabled={busy} onClick={() => openAdd(node.id)}>
                {t.addSub}
              </button>
              <button type="button" disabled={busy} onClick={() => setActive(node, !node.isActive)}>
                {node.isActive ? t.disable : t.enable}
              </button>
            </span>
          )}
        </div>

        {draft && draft.parentId === node.id && canWrite && renderAddForm(depth + 1)}
        {hasKids && !isCollapsed && (node.children ?? []).map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  function renderAddForm(depth: number) {
    if (!draft) return null;
    return (
      <form className="cat-add" style={{ marginLeft: 6 + depth * 18 }} onSubmit={submitAdd}>
        <input
          placeholder={t.nameAm}
          value={draft.nameAm}
          onChange={(e) => setDraft({ ...draft, nameAm: e.target.value })}
          required
        />
        <input
          placeholder={t.nameEn}
          value={draft.nameEn}
          onChange={(e) => {
            const nameEn = e.target.value;
            setDraft({ ...draft, nameEn, slug: draft.slugTouched ? draft.slug : slugify(nameEn) });
          }}
        />
        <input
          placeholder={t.nameOm}
          value={draft.nameOm}
          onChange={(e) => setDraft({ ...draft, nameOm: e.target.value })}
        />
        <input
          placeholder={t.nameTi}
          value={draft.nameTi}
          onChange={(e) => setDraft({ ...draft, nameTi: e.target.value })}
        />
        <input
          placeholder={t.slug}
          title={t.slugHint}
          value={draft.slug}
          onChange={(e) => setDraft({ ...draft, slug: e.target.value, slugTouched: true })}
          required
        />
        <button type="submit" className="button primary" disabled={busy}>
          {t.create}
        </button>
        <button type="button" className="button secondary" onClick={() => setDraft(null)}>
          {t.cancel}
        </button>
      </form>
    );
  }

  return (
    <div className="cat-tree">
      <div className="cat-tree-head">
        {canWrite && (
          <button type="button" className="button primary" onClick={() => openAdd(null)}>
            {t.addRoot}
          </button>
        )}
        {canWrite && (
          <label className="cat-toggle-inactive">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            {t.showInactive}
          </label>
        )}
      </div>

      {draft && draft.parentId === null && canWrite && renderAddForm(0)}

      {nodes.length === 0 ? (
        <p className="cat-empty">{t.noCategories}</p>
      ) : (
        nodes.map((n) => renderNode(n, 0))
      )}
    </div>
  );
}
