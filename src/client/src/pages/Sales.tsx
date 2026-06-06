import { useState, useEffect, useCallback } from "react";
import { DollarSign, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/Table";
import { MetricCard } from "../components/MetricCard";
import { api } from "../lib/api";

type SalesDay = {
  date: string;
  paket_a: number;
  paket_b: number;
  legacy: number;
  units: number;
  total_rp: number;
};

type SalesSummary = {
  total_units: number;
  total_rp: number;
  today_units: number;
  today_rp: number;
  yesterday_units: number;
  yesterday_rp: number;
};

type SalesResponse = {
  days: SalesDay[];
  summary: SalesSummary;
};

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

function formatRp(n: number): string {
  return "RP " + n.toLocaleString("id-ID");
}

export function Sales() {
  const [days, setDays] = useState<SalesDay[]>([]);
  const [summary, setSummary] = useState<SalesSummary>({ total_units: 0, total_rp: 0, today_units: 0, today_rp: 0, yesterday_units: 0, yesterday_rp: 0 });
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(daysAgoStr(7));
  const [to, setTo] = useState(todayStr());
  const [activePreset, setActivePreset] = useState<string>("7days");

  const fetchSales = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true);
    try {
      const data = await api<SalesResponse>(`/admin/sales?from=${fromDate}&to=${toDate}`);
      setDays(data.days);
      setSummary(data.summary);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSales(from, to);
  }, [from, to, fetchSales]);

  function applyPreset(preset: string) {
    setActivePreset(preset);
    switch (preset) {
      case "today":
        setFrom(todayStr());
        setTo(todayStr());
        break;
      case "yesterday":
        setFrom(yesterdayStr());
        setTo(yesterdayStr());
        break;
      case "7days":
        setFrom(daysAgoStr(7));
        setTo(todayStr());
        break;
    }
  }

  function handleFromChange(val: string) {
    setFrom(val);
    setActivePreset("");
  }

  function handleToChange(val: string) {
    setTo(val);
    setActivePreset("");
  }

  const totals = days.reduce(
    (acc, d) => ({
      paket_a: acc.paket_a + d.paket_a,
      paket_b: acc.paket_b + d.paket_b,
      legacy: acc.legacy + d.legacy,
      units: acc.units + d.units,
      total_rp: acc.total_rp + d.total_rp,
    }),
    { paket_a: 0, paket_b: 0, legacy: 0, units: 0, total_rp: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-500" />
            Sales
          </h2>
          <p className="text-sm text-text-muted mt-1">Daily sales breakdown by package</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => fetchSales(from, to)}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => applyPreset("today")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer transition-colors ${
              activePreset === "today"
                ? "bg-primary-500 text-white border-primary-500"
                : "bg-surface border-border text-text-muted hover:bg-surface-secondary"
            }`}
          >
            Today
          </button>
          <button
            onClick={() => applyPreset("yesterday")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer transition-colors ${
              activePreset === "yesterday"
                ? "bg-primary-500 text-white border-primary-500"
                : "bg-surface border-border text-text-muted hover:bg-surface-secondary"
            }`}
          >
            Yesterday
          </button>
          <button
            onClick={() => applyPreset("7days")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer transition-colors ${
              activePreset === "7days"
                ? "bg-primary-500 text-white border-primary-500"
                : "bg-surface border-border text-text-muted hover:bg-surface-secondary"
            }`}
          >
            Last 7 Days
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-text-muted text-xs">From:</label>
          <input
            type="date"
            value={from}
            onChange={(e) => handleFromChange(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-md border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <label className="text-text-muted text-xs">To:</label>
          <input
            type="date"
            value={to}
            onChange={(e) => handleToChange(e.target.value)}
            className="px-2 py-1.5 text-xs rounded-md border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Today's Sales" value={formatRp(summary.today_rp)} icon={<DollarSign className="h-4 w-4" />} />
        <MetricCard label="Yesterday" value={formatRp(summary.yesterday_rp)} icon={<DollarSign className="h-4 w-4" />} />
        <MetricCard label="Units Today" value={summary.today_units} />
        <MetricCard label="Period Total" value={formatRp(summary.total_rp)} icon={<DollarSign className="h-4 w-4" />} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin h-6 w-6 text-primary-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <>
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-center">A</TableHead>
                  <TableHead className="text-center">B</TableHead>
                  <TableHead className="text-center">Legacy</TableHead>
                  <TableHead className="text-center">Units</TableHead>
                  <TableHead className="text-right">Total (RP)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-text-muted py-8">No sales in this period</TableCell>
                  </TableRow>
                ) : (
                  <>
                    {days.map((day) => (
                      <TableRow key={day.date}>
                        <TableCell className="font-medium text-text-primary">
                          {day.date}
                          {day.date === todayStr() && <Badge variant="success" className="ml-2">Today</Badge>}
                          {day.date === yesterdayStr() && <Badge variant="info" className="ml-2">Yesterday</Badge>}
                        </TableCell>
                        <TableCell className="text-center">
                          {day.paket_a ? (
                            <Badge variant="info">A ({day.paket_a})</Badge>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          {day.paket_b ? (
                            <Badge variant="success">B ({day.paket_b})</Badge>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-center">{day.legacy || "-"}</TableCell>
                        <TableCell className="text-center font-medium">{day.units}</TableCell>
                        <TableCell className="text-right font-semibold text-green-600">{formatRp(day.total_rp)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 border-border bg-surface-secondary">
                      <TableCell className="font-bold text-text-primary">TOTAL</TableCell>
                      <TableCell className="text-center font-bold">
                        {totals.paket_a ? <Badge variant="info">A ({totals.paket_a})</Badge> : "0"}
                      </TableCell>
                      <TableCell className="text-center font-bold">
                        {totals.paket_b ? <Badge variant="success">B ({totals.paket_b})</Badge> : "0"}
                      </TableCell>
                      <TableCell className="text-center font-bold">{totals.legacy}</TableCell>
                      <TableCell className="text-center font-bold">{totals.units}</TableCell>
                      <TableCell className="text-right font-bold text-green-600">{formatRp(totals.total_rp)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="lg:hidden space-y-3">
            {days.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-8">No sales in this period</p>
            ) : (
              <>
                {days.map((day) => (
                  <div key={day.date} className="border border-border rounded-lg p-3 space-y-2 bg-surface">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-text-primary text-sm">
                        {day.date}
                        {day.date === todayStr() && <Badge variant="success" className="ml-2">Today</Badge>}
                        {day.date === yesterdayStr() && <Badge variant="info" className="ml-2">Yesterday</Badge>}
                      </span>
                      <span className="font-bold text-green-600">{formatRp(day.total_rp)}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs text-text-muted">
                      <div className="text-center">
                        <div className="font-medium text-text-primary">{day.paket_a}</div>
                        <div>A</div>
                      </div>
                      <div className="text-center">
                        <div className="font-medium text-text-primary">{day.paket_b}</div>
                        <div>B</div>
                      </div>
                      <div className="text-center">
                        <div className="font-medium text-text-primary">{day.legacy}</div>
                        <div>Legacy</div>
                      </div>
                      <div className="text-center">
                        <div className="font-medium text-text-primary">{day.units}</div>
                        <div>Units</div>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="border-2 border-primary-500 rounded-lg p-3 bg-surface">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-text-primary text-sm">TOTAL</span>
                    <span className="font-bold text-green-600">{formatRp(totals.total_rp)}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs text-text-muted mt-2">
                    <div className="text-center">
                      <div className="font-bold text-text-primary">{totals.paket_a}</div>
                      <div>A</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-text-primary">{totals.paket_b}</div>
                      <div>B</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-text-primary">{totals.legacy}</div>
                      <div>Legacy</div>
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-text-primary">{totals.units}</div>
                      <div>Units</div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}