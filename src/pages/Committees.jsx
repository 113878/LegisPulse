import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  CHAMBER,
  fetchCommittees,
  fetchCommitteeDetails,
  fetchCommitteeBills,
} from "@/services/legisGa";
import { api } from "@/api/apiClient";
import {
  Building2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  FileText,
  ExternalLink,
  Users,
  Search,
  Loader2,
  Star,
  Phone,
  MapPin,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

// ═══════════════════════════════════════════════════════════════
// Committees Page
// ═══════════════════════════════════════════════════════════════

export default function CommitteesPage() {
  // Navigation state:  chamber → committee → bills
  const [selectedChamber, setSelectedChamber] = useState(null); // "upper" | "lower"
  const [selectedCommittee, setSelectedCommittee] = useState(null); // { id, name, chamber }
  const [billTab, setBillTab] = useState("current"); // "current" | "all"
  const [searchQuery, setSearchQuery] = useState("");
  const [trackingFilter, setTrackingFilter] = useState("all"); // all | my | team | allTeams
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  // Map UI chamber ("upper"/"lower") → legis.ga.gov ChamberType enum
  const chamberCode =
    selectedChamber === "upper"
      ? CHAMBER.SENATE
      : selectedChamber === "lower"
        ? CHAMBER.HOUSE
        : null;

  // ── Fetch committees for the selected chamber ──
  const { data: committees = [], isLoading: loadingCommittees } = useQuery({
    queryKey: ["gaCommittees", chamberCode],
    queryFn: () => fetchCommittees(chamberCode),
    enabled: !!chamberCode,
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch committee details (members, address) ──
  const { data: committeeDetails, isLoading: loadingDetails } = useQuery({
    queryKey: ["committeeDetails", selectedCommittee?.id],
    queryFn: () => fetchCommitteeDetails(selectedCommittee.id),
    enabled: !!selectedCommittee?.id,
    staleTime: 5 * 60 * 1000,
  });

  // ── Fetch bills for the selected committee ──
  const { data: committeeBills = [], isLoading: loadingBills } = useQuery({
    queryKey: ["committeeBills", selectedCommittee?.id],
    queryFn: () => fetchCommitteeBills(selectedCommittee.id),
    enabled: !!selectedCommittee?.id,
    staleTime: 5 * 60 * 1000,
  });

  // ── Bill-tracking queries (My Bills / Team Bills) ──
  const { data: userData } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.auth.me().catch(() => null),
  });
  const personalTrackedBills = userData?.tracked_bill_ids ?? [];

  const { data: allTeamData } = useQuery({
    queryKey: ["allTeams"],
    queryFn: () =>
      api.entities.Team.getAll().catch(() => ({
        teams: [],
        __pendingInvites: [],
      })),
  });
  const allTeams = allTeamData?.teams ?? [];

  useEffect(() => {
    if (allTeams.length > 0 && !selectedTeamId) {
      setSelectedTeamId(allTeams[0].id);
    }
  }, [allTeams, selectedTeamId]);

  const { data: selectedTeamBillNumbers = [] } = useQuery({
    queryKey: ["teamBills", selectedTeamId],
    queryFn: () => api.entities.Team.getBillNumbers(selectedTeamId),
    enabled: !!selectedTeamId,
    staleTime: 0,
  });

  const allTeamBillQueries = useQueries({
    queries: allTeams.map((t) => ({
      queryKey: ["teamBills", t.id],
      queryFn: () => api.entities.Team.getBillNumbers(t.id),
      staleTime: 0,
    })),
  });
  const allTeamsBillNumbers = useMemo(() => {
    const combined = [];
    allTeamBillQueries.forEach((q) => {
      if (q.data) combined.push(...q.data);
    });
    return combined;
  }, [allTeamBillQueries]);

  const normalizeBillId = useCallback(
    (id) =>
      String(id ?? "")
        .replace(/\s+/g, "")
        .toUpperCase(),
    [],
  );

  // Build a Set of normalised tracked bill IDs for the active filter
  const trackedBillSet = useMemo(() => {
    if (trackingFilter === "my") {
      return new Set(personalTrackedBills.map(normalizeBillId));
    }
    if (trackingFilter === "team") {
      return new Set(selectedTeamBillNumbers.map(normalizeBillId));
    }
    if (trackingFilter === "allTeams") {
      return new Set(allTeamsBillNumbers.map(normalizeBillId));
    }
    // "all" = personal tracked + all teams combined
    const combined = [...personalTrackedBills, ...allTeamsBillNumbers];
    return new Set(combined.map(normalizeBillId));
  }, [
    trackingFilter,
    personalTrackedBills,
    selectedTeamBillNumbers,
    allTeamsBillNumbers,
    normalizeBillId,
  ]);

  // Split bills: "current" tab = tracked bills in this committee, "all" = all committee bills
  const { currentBills, allBills } = useMemo(() => {
    const current = committeeBills.filter((b) =>
      trackedBillSet.has(normalizeBillId(b.identifier)),
    );
    return { currentBills: current, allBills: committeeBills };
  }, [committeeBills, trackedBillSet, normalizeBillId]);

  const displayedBills = billTab === "current" ? currentBills : allBills;

  // Filter bills by search
  const filteredBills = useMemo(() => {
    if (!searchQuery.trim()) return displayedBills;
    const q = searchQuery.toLowerCase();
    return displayedBills.filter(
      (b) =>
        b.identifier.toLowerCase().includes(q) ||
        b.title.toLowerCase().includes(q) ||
        b.abstract.toLowerCase().includes(q),
    );
  }, [displayedBills, searchQuery]);

  // ── Chamber selection screen ──
  if (!selectedChamber) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-100 mb-4">
              <Building2 className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Georgia Legislative Committees
            </h1>
            <p className="text-slate-500 mt-2">
              Select a chamber to browse committees and their legislation
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* House */}
            <button
              onClick={() => setSelectedChamber("lower")}
              className="group relative overflow-hidden rounded-2xl border-2 border-emerald-200 bg-white p-8 text-left transition-all hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-100"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-[80px] -mr-4 -mt-4 transition-all group-hover:bg-emerald-100" />
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-4 group-hover:bg-emerald-200 transition-colors">
                  <Building2 className="w-6 h-6 text-emerald-700" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">House</h2>
                <p className="text-sm text-slate-500">
                  House of Representatives committees
                </p>
                <div className="flex items-center gap-1 text-emerald-600 text-sm font-medium mt-4">
                  Browse committees <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </button>

            {/* Senate */}
            <button
              onClick={() => setSelectedChamber("upper")}
              className="group relative overflow-hidden rounded-2xl border-2 border-blue-200 bg-white p-8 text-left transition-all hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-bl-[80px] -mr-4 -mt-4 transition-all group-hover:bg-blue-100" />
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                  <Building2 className="w-6 h-6 text-blue-700" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-1">
                  Senate
                </h2>
                <p className="text-sm text-slate-500">Senate committees</p>
                <div className="flex items-center gap-1 text-blue-600 text-sm font-medium mt-4">
                  Browse committees <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const chamberLabel = selectedChamber === "upper" ? "Senate" : "House";
  const chamberColor = selectedChamber === "upper" ? "blue" : "emerald";

  // ── Committee list screen ──
  if (!selectedCommittee) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* Back button */}
          <button
            onClick={() => setSelectedChamber(null)}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-6 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to chambers
          </button>

          <div className="flex items-center gap-3 mb-6">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                chamberColor === "blue" ? "bg-blue-100" : "bg-emerald-100"
              }`}
            >
              <Building2
                className={`w-5 h-5 ${
                  chamberColor === "blue" ? "text-blue-700" : "text-emerald-700"
                }`}
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {chamberLabel} Committees
              </h1>
              <p className="text-sm text-slate-500">
                {committees.length} committee
                {committees.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {loadingCommittees ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
              <span className="ml-2 text-sm text-slate-500">
                Loading committees…
              </span>
            </div>
          ) : committees.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              No committees found
            </div>
          ) : (
            <div className="space-y-2">
              {committees.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCommittee(c);
                    setBillTab("current");
                    setSearchQuery("");
                    setTrackingFilter("all");
                  }}
                  className="w-full flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all text-left group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        chamberColor === "blue"
                          ? "bg-blue-50 text-blue-600"
                          : "bg-emerald-50 text-emerald-600"
                      }`}
                    >
                      <Users className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-slate-800 truncate">
                      {c.name}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Committee detail screen (bills) ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-slate-500 mb-6">
          <button
            onClick={() => {
              setSelectedChamber(null);
              setSelectedCommittee(null);
            }}
            className="hover:text-slate-800 transition-colors"
          >
            Committees
          </button>
          <ChevronRight className="w-3 h-3" />
          <button
            onClick={() => setSelectedCommittee(null)}
            className="hover:text-slate-800 transition-colors"
          >
            {chamberLabel}
          </button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-slate-800 font-medium truncate">
            {selectedCommittee.name}
          </span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                chamberColor === "blue" ? "bg-blue-100" : "bg-emerald-100"
              }`}
            >
              <Users
                className={`w-5 h-5 ${
                  chamberColor === "blue" ? "text-blue-700" : "text-emerald-700"
                }`}
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-slate-900 truncate">
                {selectedCommittee.name}
              </h1>
              <p className="text-sm text-slate-500">{chamberLabel} Committee</p>
            </div>
            <a
              href={`https://www.legis.ga.gov/committees/${chamberLabel.toLowerCase()}/${selectedCommittee.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 shrink-0"
              title="View on legis.ga.gov"
            >
              legis.ga.gov <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Committee info card (address, phone, members) */}
        <CommitteeInfoCard
          details={committeeDetails}
          loading={loadingDetails}
          chamberColor={chamberColor}
        />

        {/* Tabs: Current vs All */}
        <div className="flex items-center gap-4 mb-4 border-b border-slate-200">
          <button
            onClick={() => setBillTab("current")}
            className={`pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors ${
              billTab === "current"
                ? `border-${chamberColor}-600 text-${chamberColor}-700`
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            style={
              billTab === "current"
                ? {
                    borderColor:
                      chamberColor === "blue" ? "#2563eb" : "#059669",
                    color: chamberColor === "blue" ? "#1d4ed8" : "#047857",
                  }
                : undefined
            }
          >
            Currently Assigned
            {!loadingBills && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {currentBills.length}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setBillTab("all")}
            className={`pb-2.5 px-1 text-sm font-medium border-b-2 transition-colors ${
              billTab === "all"
                ? `border-${chamberColor}-600 text-${chamberColor}-700`
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
            style={
              billTab === "all"
                ? {
                    borderColor:
                      chamberColor === "blue" ? "#2563eb" : "#059669",
                    color: chamberColor === "blue" ? "#1d4ed8" : "#047857",
                  }
                : undefined
            }
          >
            All Bills
            {!loadingBills && (
              <Badge variant="secondary" className="ml-1.5 text-[10px]">
                {allBills.length}
              </Badge>
            )}
          </button>
        </div>

        {/* Tracking filter (only for Currently Assigned tab) */}
        {billTab === "current" && (
          <div className="flex items-center gap-1 mb-4 rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-fit overflow-hidden">
            <button
              onClick={() => setTrackingFilter("all")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                trackingFilter === "all"
                  ? "bg-slate-800 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              All Tracked
            </button>
            <button
              onClick={() => setTrackingFilter("my")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                trackingFilter === "my"
                  ? "bg-yellow-500 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Star className="w-3 h-3 inline mr-0.5 -mt-0.5" />
              My Bills
            </button>
            <div className="flex">
              <button
                onClick={() => setTrackingFilter("allTeams")}
                className={`px-2.5 py-1 text-xs font-medium rounded-l transition-colors border-r ${
                  trackingFilter === "team" || trackingFilter === "allTeams"
                    ? "bg-indigo-600 text-white border-indigo-400"
                    : "bg-white text-slate-600 hover:bg-slate-100 border-slate-200"
                }`}
              >
                <Users className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                {trackingFilter === "allTeams"
                  ? "All Teams"
                  : trackingFilter === "team" && selectedTeamId
                    ? (allTeams.find((t) => t.id === selectedTeamId)?.name ??
                      "Team Bills")
                    : "Team Bills"}
              </button>
              {allTeams.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`px-1.5 py-1 text-xs font-medium rounded-r transition-colors ${
                        trackingFilter === "team" ||
                        trackingFilter === "allTeams"
                          ? "bg-indigo-600 text-white hover:bg-indigo-700"
                          : "bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="text-xs">
                    {allTeams.length > 1 && (
                      <DropdownMenuItem
                        className={`text-xs cursor-pointer ${
                          trackingFilter === "allTeams" ? "font-semibold" : ""
                        }`}
                        onClick={() => setTrackingFilter("allTeams")}
                      >
                        All Teams
                      </DropdownMenuItem>
                    )}
                    {allTeams.map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        className={`text-xs cursor-pointer ${
                          trackingFilter === "team" && selectedTeamId === t.id
                            ? "font-semibold"
                            : ""
                        }`}
                        onClick={() => {
                          setSelectedTeamId(t.id);
                          setTrackingFilter("team");
                        }}
                      >
                        {t.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search bills…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Bills list */}
        {loadingBills ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            <span className="ml-2 text-sm text-slate-500">Loading bills…</span>
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              {searchQuery
                ? "No bills match your search"
                : billTab === "current"
                  ? "No tracked bills in this committee"
                  : "No bills found for this committee"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredBills.map((bill) => (
              <BillRow key={bill.id} bill={bill} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bill Row Component ──────────────────────────────────────
function BillRow({ bill }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-sm text-slate-900">
                {bill.identifier}
              </span>
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  bill.chamber === "Senate"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                {bill.chamber}
              </Badge>
              {bill.isCurrentlyAssigned && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-amber-50 text-amber-700 border-amber-200"
                >
                  Currently Assigned
                </Badge>
              )}
            </div>
            <p className="text-sm text-slate-700 line-clamp-2">{bill.title}</p>
            {bill.latest_action && (
              <p className="text-xs text-slate-400 mt-1.5">
                Latest: {bill.latest_action}
                {bill.latest_action_date && ` · ${bill.latest_action_date}`}
              </p>
            )}
          </div>
          {bill.openstates_url && (
            <a
              href={bill.openstates_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700 shrink-0"
              title="View on Open States"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
            {bill.abstract && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                  Summary
                </h4>
                <p className="text-sm text-slate-600">{bill.abstract}</p>
              </div>
            )}

            {bill.sponsors.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                  Sponsors
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {bill.sponsors.map((s, i) => (
                    <Badge
                      key={i}
                      variant="outline"
                      className="text-xs bg-slate-50"
                    >
                      {s.name}
                      {s.party && (
                        <span className="text-slate-400 ml-1">({s.party})</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {bill.committeeActions.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                  Committee Actions
                </h4>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {bill.committeeActions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-slate-400 shrink-0 w-20">
                        {a.date}
                      </span>
                      <span className="text-slate-600">{a.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Committee Info Card (address, phone, members) ───────────
function CommitteeInfoCard({ details, loading, chamberColor }) {
  const [showAllMembers, setShowAllMembers] = useState(false);

  if (loading) {
    return (
      <Card className="p-4 mb-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
        <span className="ml-2 text-xs text-slate-500">
          Loading committee info…
        </span>
      </Card>
    );
  }
  if (!details) return null;

  const { address, members = [] } = details;
  // Sort by roleSort so Chairman/Vice/Secretary come first
  const sortedMembers = [...members].sort(
    (a, b) => (a.roleSort ?? 99) - (b.roleSort ?? 99),
  );
  const previewCount = 6;
  const displayed = showAllMembers
    ? sortedMembers
    : sortedMembers.slice(0, previewCount);
  const hasMore = sortedMembers.length > previewCount;

  const roleColor = (role) => {
    const r = (role || "").toLowerCase();
    if (r.includes("chair") && !r.includes("vice"))
      return "bg-amber-100 text-amber-800 border-amber-200";
    if (r.includes("vice"))
      return "bg-orange-50 text-orange-700 border-orange-200";
    if (r.includes("secretary"))
      return "bg-purple-50 text-purple-700 border-purple-200";
    if (r.includes("ex officio"))
      return "bg-slate-100 text-slate-600 border-slate-200";
    return chamberColor === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";
  };

  const cleanZip = (address?.zip ?? "").trim();
  const cleanState = (address?.state ?? "").trim();
  const cleanPhone = (address?.phone ?? "").replace(/\D/g, "");
  const phoneDisplay =
    cleanPhone.length === 10
      ? `(${cleanPhone.slice(0, 3)}) ${cleanPhone.slice(3, 6)}-${cleanPhone.slice(6)}`
      : (address?.phone ?? "");

  return (
    <Card className="p-4 mb-6">
      {address && (address.address1 || address.phone) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-slate-600 mb-4 pb-4 border-b border-slate-100">
          {address.address1 && (
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              {address.address1}
              {address.address2 ? `, ${address.address2}` : ""}
              {address.city ? `, ${address.city}` : ""}
              {cleanState ? `, ${cleanState}` : ""}
              {cleanZip ? ` ${cleanZip}` : ""}
            </span>
          )}
          {cleanPhone && (
            <a
              href={`tel:+1${cleanPhone}`}
              className="flex items-center gap-1.5 hover:text-slate-900"
            >
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              {phoneDisplay}
            </a>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Members ({sortedMembers.length})
        </h3>
      </div>

      {sortedMembers.length === 0 ? (
        <p className="text-xs text-slate-400">No members listed.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {displayed.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 p-2 rounded-md bg-slate-50 border border-slate-100"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {m.name}
                  </div>
                  {m.district && (
                    <div className="text-[11px] text-slate-500">
                      District {m.district}
                    </div>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${roleColor(m.role)}`}
                >
                  {m.role}
                </Badge>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setShowAllMembers((v) => !v)}
              className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1"
            >
              {showAllMembers
                ? "Show fewer"
                : `Show all ${sortedMembers.length} members`}
              <ChevronDown
                className={`w-3 h-3 transition-transform ${showAllMembers ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </>
      )}
    </Card>
  );
}
