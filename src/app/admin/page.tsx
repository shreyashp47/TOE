"use client";

/**
 * Owner menu management (docs/requirements.md §4.3 step 2, §5.1).
 *
 * "Owner can edit menu without a developer" — so: plain labels, inline edit,
 * an availability switch for the sold-out case, and a running category list
 * built from what the cafe actually has.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { CategoryPicker } from "@/components/CategoryPicker";
import { Icon, categoryIcon, itemArtIcon } from "@/components/icons";
import {
  useConfigRepo,
  useIsDemo,
  useMenu,
  useMenuRepo,
  useSpecialOffer,
} from "@/components/providers/DataProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, Loading } from "@/components/ui/Loading";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { formatINR } from "@/lib/money";
import { SEED_MENU } from "@/lib/data/seed";
import type { MenuItem } from "@/lib/types";

export default function AdminMenuPage() {
  const { items, loading } = useMenu();
  const repo = useMenuRepo();
  const isDemo = useIsDemo();
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category))].sort(),
    [items],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()];
  }, [items]);

  const run = useCallback(
    async (id: string | null, fn: () => Promise<void>) => {
      setSavingId(id);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "That change didn't save.",
        );
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  if (loading || !repo) return <Loading label="Reading the menu…" />;

  return (
    <div className="flex flex-col gap-5 pb-8">
      {error ? (
        <p
          role="alert"
          className="border-berry bg-paper text-berry-deep rounded-md border-2 px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <FeatureCards />

      <SpecialOfferCard />

      <AddItemCard categories={categories} onError={setError} />

      {items.length === 0 ? (
        <EmptyState
          title="No items yet"
          body="Add your first drink above, or restore the sample menu below."
        />
      ) : (
        grouped.map(([category, list]) => (
          <section key={category} aria-labelledby={`m-${category}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-pill bg-secondary/15 text-secondary grid size-9 place-items-center">
                <Icon name={categoryIcon(category)} size={20} />
              </span>
              <h2 id={`m-${category}`} className="text-xl">
                {category}
              </h2>
              <span className="tnum text-muted text-sm">({list.length})</span>
            </div>

            <ul className="flex flex-col gap-2.5">
              {list.map((item) => (
                <MenuRow
                  key={item.id}
                  item={item}
                  categories={categories}
                  busy={savingId === item.id}
                  onPatch={(patch) =>
                    run(item.id, () => repo.update(item.id, patch))
                  }
                  onDelete={() =>
                    run(item.id, async () => {
                      if (
                        !window.confirm(
                          `Remove "${item.name}" from the menu? Past orders keep it.`,
                        )
                      ) {
                        return;
                      }
                      await repo.remove(item.id);
                    })
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {isDemo ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="text-base">Reset the sample menu</h2>
            <p className="text-muted text-sm">
              Demo data only. This replaces the current menu with{" "}
              {SEED_MENU.length} sample items.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              void run("reset", async () => {
                if (
                  !window.confirm("Replace the whole menu with the samples?")
                ) {
                  return;
                }
                await repo.replaceAll(SEED_MENU.map((i) => ({ ...i })));
              })
            }
          >
            <Icon name="trash" size={18} />
            Reset samples
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

/** Theme doc §4: the "Manage Products / Fast Billing" icon-card pattern. */
function FeatureCards() {
  const cards = [
    { icon: "drink" as const, label: "Edit anything" },
    { icon: "clock" as const, label: "Live instantly" },
    { icon: "chart" as const, label: "Monthly reports" },
    { icon: "qr" as const, label: "Table QR codes" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {cards.map((card) => (
        <li
          key={card.label}
          className="border-line-soft bg-paper flex flex-col items-center gap-1.5 rounded-lg border-2 p-3 text-center"
        >
          <span className="rounded-pill bg-highlight-soft text-primary grid size-10 place-items-center">
            <Icon name={card.icon} size={20} />
          </span>
          <span className="text-2xs text-muted font-semibold tracking-wide uppercase">
            {card.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SpecialOfferCard() {
  const repo = useConfigRepo();
  const offer = useSpecialOffer();
  const [text, setText] = useState(offer.text);
  const [enabled, setEnabled] = useState(offer.enabled);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    setText(offer.text);
    setEnabled(offer.enabled);
  }, [offer.text, offer.enabled]);

  async function save() {
    if (!repo) return;
    setState("saving");
    try {
      await repo.save({ enabled, text });
      setState("saved");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg">Today&apos;s special</h2>
          <p className="text-muted text-sm">
            One short line customers see pinned to the top of the menu.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-1">
          <span className="sr-only">Show the special</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-6 accent-[var(--primary)]"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field
            label="Message"
            htmlFor="special-text"
            hint="Up to 140 characters."
          >
            <Input
              id="special-text"
              value={text}
              maxLength={140}
              onChange={(e) => setText(e.target.value)}
              placeholder="Free refills before 11am"
            />
          </Field>
        </div>
        <Button
          onClick={() => void save()}
          disabled={state === "saving" || !text.trim()}
        >
          {state === "saving"
            ? "Saving…"
            : state === "saved"
              ? "Saved ✓"
              : "Save"}
        </Button>
      </div>
      {state === "error" ? (
        <p role="alert" className="text-berry-deep mt-2 text-sm font-semibold">
          That didn&apos;t save. Try again.
        </p>
      ) : null}
    </Card>
  );
}

function AddItemCard({
  categories,
  onError,
}: {
  categories: string[];
  onError: (message: string | null) => void;
}) {
  const repo = useMenuRepo();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  // null until the owner picks one: the menu loads after the first render, so
  // the default has to follow it rather than be fixed at mount. A picked
  // category that has since left the menu (its last item moved or deleted)
  // falls back to the default too, so the form never files an item under a
  // category the select no longer shows.
  const [picked, setPicked] = useState<{ name: string; isNew: boolean } | null>(
    null,
  );
  const category =
    picked && (picked.isNew || categories.includes(picked.name))
      ? picked.name
      : (categories[0] ?? "");
  // Remounts the picker after an add, so a just-created category shows as a
  // normal choice in the list instead of an open "new category" box.
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const priceError =
    price.trim() === ""
      ? undefined
      : Number.isFinite(Number(price)) && Number(price) > 0
        ? undefined
        : "Enter a price above 0.";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo) return;
    if (!name.trim() || priceError) {
      onError("Give the item a name and a valid price.");
      return;
    }
    if (!category.trim()) {
      onError("Give the new category a name.");
      return;
    }
    onError(null);
    setBusy(true);
    try {
      await repo.create({
        name: name.trim(),
        description: description.trim(),
        price: Math.round(Number(price)),
        category: category.trim(),
      });
      setName("");
      setDescription("");
      setPrice("");
      setPicked({ name: category.trim(), isNew: false });
      setFormKey((k) => k + 1);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add that item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <h2 className="text-lg">Add an item</h2>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="new-name">
          <Input
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cardamom Bun"
            required
          />
        </Field>
        <Field label="Price (₹)" htmlFor="new-price" error={priceError}>
          <Input
            id="new-price"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="140"
            required
          />
        </Field>
        <Field label="Category" htmlFor="new-category">
          <CategoryPicker
            key={formKey}
            id="new-category"
            categories={categories}
            value={category}
            onChange={(name, isNew) => setPicked({ name, isNew })}
          />
        </Field>
        <Field label="Short description" htmlFor="new-desc" hint="Optional.">
          <Textarea
            id="new-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Warm, sugary, cardamom-heavy."
            rows={2}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy} size="md">
            <Icon name="plus" size={18} />
            {busy ? "Adding…" : "Add to menu"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MenuRow({
  item,
  categories,
  busy,
  onPatch,
  onDelete,
}: {
  item: MenuItem;
  categories: string[];
  busy: boolean;
  onPatch: (patch: Partial<MenuItem>) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const dirty =
    draft.name !== item.name ||
    draft.description !== item.description ||
    draft.price !== item.price ||
    draft.category !== item.category;

  useEffect(() => {
    setDraft(item);
  }, [item]);

  const priceError =
    Number.isFinite(draft.price) && draft.price > 0
      ? undefined
      : "Price must be above 0.";

  return (
    <li
      className={[
        "bg-paper shadow-card rounded-lg border-2 p-3 transition-opacity",
        dirty ? "border-highlight" : "border-line-soft",
        !item.available ? "opacity-70" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div className="bg-highlight-soft/70 text-primary grid size-11 shrink-0 place-items-center rounded-md">
          <Icon name={itemArtIcon(item.art)} size={22} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="grid gap-2 sm:grid-cols-[1fr_6rem]">
            <Field label="Name" htmlFor={`name-${item.id}`}>
              <Input
                id={`name-${item.id}`}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field
              label="Price"
              htmlFor={`price-${item.id}`}
              error={priceError}
            >
              <Input
                id={`price-${item.id}`}
                inputMode="numeric"
                value={String(draft.price)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    price: Math.max(0, Math.round(Number(e.target.value) || 0)),
                  })
                }
              />
            </Field>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem]">
            <Field label="Description" htmlFor={`desc-${item.id}`}>
              <Input
                id={`desc-${item.id}`}
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </Field>
            <Field label="Category" htmlFor={`cat-${item.id}`}>
              <Select
                id={`cat-${item.id}`}
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              >
                {[...new Set([...categories, draft.category])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </div>

      <div className="border-line-soft mt-3 flex flex-wrap items-center gap-2 border-t-2 pt-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={item.available}
          onClick={() => onPatch({ available: !item.available })}
          disabled={busy}
          className={[
            "rounded-pill font-round flex min-h-11 items-center gap-2 border-2 px-3.5 text-sm",
            item.available
              ? "border-sage bg-sage-soft text-sage-deep"
              : "border-berry/50 bg-berry/10 text-berry-deep",
          ].join(" ")}
        >
          <span
            className={[
              "rounded-pill relative h-5 w-9 transition-colors",
              item.available ? "bg-sage" : "bg-berry/40",
            ].join(" ")}
          >
            <span
              className={[
                "rounded-pill absolute top-0.5 size-4 bg-white transition-transform",
                item.available ? "translate-x-4.5" : "translate-x-0.5",
              ].join(" ")}
            />
          </span>
          {item.available ? "Available" : "Sold out"}
        </button>

        <span className="tnum text-muted ml-auto text-sm">
          {formatINR(item.price)}
        </span>

        {dirty ? (
          <Button
            size="sm"
            disabled={busy || Boolean(priceError) || !draft.name.trim()}
            onClick={() =>
              onPatch({
                name: draft.name.trim(),
                description: draft.description.trim(),
                price: draft.price,
                category: draft.category.trim() || "Drinks",
              })
            }
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        ) : null}

        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete ${item.name}`}
          className="rounded-pill border-line bg-paper text-muted hover:border-berry hover:text-berry-deep grid size-11 place-items-center border-2 transition-colors"
        >
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  );
}
