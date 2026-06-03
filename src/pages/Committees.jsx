import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import {
  ChevronLeft,
  ChevronRight,
  Landmark,
  Search,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── Helpers ───────────────────────────────────────────────────

function normalizeChamber(raw) {
  const s = (raw ?? "").toLowerCase();
  if (s === "h" || s === "house" || s === "lower") return "House";
  if (s === "s" || s === "senate" || s === "upper") return "Senate";
  return null;
}

// Returns true if this bill has ever been associated with committeeName,
// either as the current assignment or in any history action text.
function billRelatedToCommittee(bill, committeeName) {
  const lower = committeeName.toLowerCase();
  if ((bill.current_committee ?? "").toLowerCase() === lower) return true;
  if (Array.isArray(bill.history)) {
    for (const entry of bill.history) {
      const text = (
        entry.action ??
        entry.description ??
        entry.text ??
        ""
      ).toLowerCase();
      if (text.includes(lower)) return true;
    }
  }
  return false;
}

const STATUS_COLORS = {
  introduced: "bg-blue-100 text-blue-800",
  passed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  vetoed: "bg-red-100 text-red-800",
  signed: "bg-emerald-100 text-emerald-800",
  committee: "bg-yellow-100 text-yellow-800",
  engrossed: "bg-purple-100 text-purple-800",
  enrolled: "bg-teal-100 text-teal-800",
  amended: "bg-orange-100 text-orange-800",
};

function StatusBadge({ status }) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>;
  const normalized = status.toLowerCase().replace(/_/g, " ");
  const key = Object.keys(STATUS_COLORS).find((k) => normalized.includes(k));
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
        key ? STATUS_COLORS[key] : "bg-slate-100 text-slate-700"
      }`}
    >
      {normalized}
    </span>
  );
}

// ── Bill table used in both tabs ──────────────────────────────

function BillTable({ bills, emptyText }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("bill_number");
  const [sortDir, setSortDir] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? bills.filter(
          (b) =>
            (b.bill_number ?? "").toLowerCase().includes(q) ||
            (b.title ?? "").toLowerCase().includes(q) ||
            (b.sponsor ?? b.primary_sponsor ?? "").toLowerCase().includes(q),
        )
      : bills;

    return [...list].sort((a, b) => {
      const av = (a[sortKey] ?? "").toString().toLowerCase();
      const bv = (b[sortKey] ?? "").toString().toLowerCase();
      if (av === bv) return 0;
      return av > bv ? sortDir : -sortDir;
    });
  }, [bills, search, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  };

  const SortHeader = ({ col, label }) => (
    <th
      className="text-left font-semibold text-slate-600 px-4 py-3 cursor-pointer select-none hover:text-slate-900 whitespace-nowrap"
      onClick={() => toggleSort(col)}
    >
      {label}
      {sortKey === col && (
        <span className="ml-1 text-slate-400">{sortDir === 1 ? "↑" : "↓"}</span>
      )}
    </th>
  );

  if (bills.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500 bg-white rounded-xl border border-slate-200">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <Input
          placeholder="Search bills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <SortHeader col="bill_number" label="Bill #" />
                <SortHeader col="title" label="Title" />
                <SortHeader col="sponsor" label="Sponsor" />
                <SortHeader col="status" label="Status" />
                <SortHeader col="current_committee" label="Current Committee" />
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((bill, i) => (
                <tr
                  key={bill.id}
                  className={`border-b border-slate-50 hover:bg-blue-50/30 transition-colors ${
                    i % 2 !== 0 ? "bg-slate-50/40" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700 whitespace-nowrap">
                    {bill.bill_number}
                  </td>
                  <td className="px-4 py-3 text-slate-800 max-w-xs">
                    <span className="line-clamp-2 leading-snug">{bill.title}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">
                    {bill.sponsor ?? bill.primary_sponsor ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={bill.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[180px]">
                    <span className="line-clamp-2">
                      {bill.current_committee ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {bill.url && (
                      <a
                        href={bill.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-blue-600 transition-colors"
                        title="View bill"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && search && (
          <div className="text-center py-8 text-slate-500 text-sm">
            No bills match "{search}"
          </div>
        )}

        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
          {filtered.length} of {bills.length} bill{bills.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════
export default function Committees() {
  const [chamber, setChamber] = useState("House");
  const [selectedCommittee, setSelectedCommittee] = useState(null);
  const [committeeSearch, setCommitteeSearch] = useState("");

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ["bills"],
    queryFn: () => api.entities.Bill.list(),
    staleTime: 5 * 60 * 1000,
  });

  // ── Build committee index ─────────────────────────────────
  // Pass 1: collect unique committee names per chamber from current_committee
  // Pass 2: count current assignments and all related bills (history scan)
  const { houseCommittees, senateCommittees } = useMemo(() => {
    const house = new Map(); // name → { currentCount, allCount }
    const senate = new Map();

    for (const bill of bills) {
      const ch = normalizeChamber(bill.chamber);
      if (!ch) continue;
      const map = ch === "House" ? house : senate;
      const comm = bill.current_committee?.trim();
      if (comm && !map.has(comm)) {
        map.set(comm, { currentCount: 0, allCount: 0 });
      }
    }

    for (const bill of bills) {
      const ch = normalizeChamber(bill.chamber);
      if (!ch) continue;
      const map = ch === "House" ? house : senate;

      for (const [name, entry] of map.entries()) {
        const isCurrent = (bill.current_committee?.trim() ?? "") === name;
        const isRelated = isCurrent || billRelatedToCommittee(bill, name);
        if (isCurrent) entry.currentCount++;
        if (isRelated) entry.allCount++;
      }
    }

    const toArray = (map) =>
      Array.from(map.entries())
        .map(([name, counts]) => ({ name, ...counts }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return { houseCommittees: toArray(house), senateCommittees: toArray(senate) };
  }, [bills]);

  const allCommittees = chamber === "House" ? houseCommittees : senateCommittees;

  const filteredCommittees = useMemo(() => {
    const q = committeeSearch.trim().toLowerCase();
    return q
      ? allCommittees.filter((c) => c.name.toLowerCase().includes(q))
      : allCommittees;
  }, [allCommittees, committeeSearch]);

  // ── Bills for selected committee ──────────────────────────
  const { currentBills, allBills } = useMemo(() => {
    if (!selectedCommittee) return { currentBills: [], allBills: [] };
    return {
      currentBills: bills.filter(
        (b) => (b.current_committee?.trim() ?? "") === selectedCommittee,
      ),
      allBills: bills.filter((b) =>
        billRelatedToCommittee(b, selectedCommittee),
      ),
    };
  }, [bills, selectedCommittee]);

  const handleBack = () => {
    setSelectedCommittee(null);
    setCommitteeSearch("");
  };

  const handleSelectCommittee = (name) => {
    setSelectedCommittee(name);
  };

  // ── Loading ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          {selectedCommittee && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="gap-1 text-slate-600 shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
          )}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-3 bg-blue-100 rounded-lg shrink-0">
              <Landmark className="w-6 h-6 text-blue-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-slate-900 truncate">
                {selectedCommittee ?? "Committees"}
              </h1>
              <p className="text-slate-500 text-sm mt-0.5">
                {selectedCommittee ? (
                  <>
                    <span className="font-medium text-slate-700">{chamber}</span>
                    {" · "}
                    <span className="text-blue-700 font-medium">{currentBills.length} currently assigned</span>
                    {" · "}
                    {allBills.length} total
                  </>
                ) : (
                  <>
                    <span className="font-medium text-slate-700">{chamber}</span>
                    {" · "}
                    {allCommittees.length} committee{allCommittees.length !== 1 ? "s" : ""}
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* ── Chamber toggle ─────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="inline-flex border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
            {["House", "Senate"].map((ch) => (
              <button
                key={ch}
                onClick={() => {
                  setChamber(ch);
                  setSelectedCommittee(null);
                  setCommitteeSearch("");
                }}
                className={`px-6 py-2 text-sm font-semibold transition-colors ${
                  chamber === ch
                    ? ch === "House"
                      ? "bg-emerald-600 text-white"
                      : "bg-blue-700 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {ch}
              </button>
            ))}
          </div>

          {!selectedCommittee && (
            <span className="text-sm text-slate-400">
              {allCommittees.length} committees
            </span>
          )}
        </div>

        {/* ── Committee list ──────────────────────────────── */}
        {!selectedCommittee && (
          <div className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <Input
                placeholder={`Search ${chamber} committees…`}
                value={committeeSearch}
                onChange={(e) => setCommitteeSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {filteredCommittees.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                {committeeSearch ? `No committees matching "${committeeSearch}"` : "No committees found."}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredCommittees.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => handleSelectCommittee(c.name)}
                    className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-blue-300 hover:shadow-md transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-slate-800 text-sm leading-snug group-hover:text-blue-700 transition-colors">
                        {c.name}
                      </p>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-0.5 group-hover:text-blue-500 transition-colors" />
                    </div>
                    <div className="flex items-center gap-4 mt-3">
                      <div className="text-center">
                        <p className="text-xl font-bold text-blue-700 leading-none">
                          {c.currentCount}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">
                          Current
                        </p>
                      </div>
                      <div className="w-px h-8 bg-slate-100" />
                      <div className="text-center">
                        <p className="text-xl font-bold text-slate-700 leading-none">
                          {c.allCount}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wide">
                          Total
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Committee detail ────────────────────────────── */}
        {selectedCommittee && (
          <Tabs defaultValue="current" className="space-y-4">
            <TabsList className="bg-white border border-slate-200">
              <TabsTrigger value="current" className="gap-2">
                Currently Assigned
                <Badge
                  variant="secondary"
                  className="bg-blue-100 text-blue-800 border-0"
                >
                  {currentBills.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="all" className="gap-2">
                All Legislation
                <Badge
                  variant="secondary"
                  className="bg-slate-100 text-slate-700 border-0"
                >
                  {allBills.length}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="current">
              <div className="mb-3 text-sm text-slate-500">
                Bills and resolutions where this committee is the current active assignment.
              </div>
              <BillTable
                bills={currentBills}
                emptyText="No bills are currently assigned to this committee."
              />
            </TabsContent>

            <TabsContent value="all">
              <div className="mb-3 text-sm text-slate-500">
                All bills and resolutions that have ever been associated with this committee,
                including current assignments and historical referrals.
              </div>
              <BillTable
                bills={allBills}
                emptyText="No bills found for this committee."
              />
            </TabsContent>
          </Tabs>
        )}

      </div>
    </div>
  );
}
