import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { motion } from "motion/react";
import React, { useEffect, useMemo, useState } from "react";
import { Award, Star, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router";
import { apiFetch } from "../../lib/api";
import { readMaterialUsageStats } from "../../lib/materialUsage";

type SimulationParams = {
  layers: { thickness: number; k: number; material?: string }[];
  boundary: { T_left: number; T_inf: number; h: number };
  area?: number;
  totalThickness?: number;
};

type SimulationResult = {
  resistance: number;
  heat_flux: number;
  temperatures: number[]; // interfaces: T0..Tn
};

function buildTempProfile(params: SimulationParams, result: SimulationResult) {
  const layers = params.layers || [];
  const temps = result.temperatures || [];
  const totalThicknessM =
    typeof params.totalThickness === "number"
      ? params.totalThickness
      : layers.reduce((s, l) => s + (l?.thickness || 0), 0);

  const points = 60;
  const data: { position: string; configA: number; configB: number }[] = [];
  if (!layers.length || temps.length !== layers.length + 1 || totalThicknessM <= 0) return data;

  const cumulative: number[] = [0];
  for (const l of layers) cumulative.push(cumulative[cumulative.length - 1] + l.thickness);

  for (let i = 0; i <= points; i++) {
    const xM = (i / points) * totalThicknessM;
    let layerIdx = 0;
    while (layerIdx < layers.length - 1 && xM > cumulative[layerIdx + 1]) layerIdx++;

    const x0 = cumulative[layerIdx];
    const x1 = cumulative[layerIdx + 1];
    const t0 = temps[layerIdx];
    const t1 = temps[layerIdx + 1];
    const frac = x1 > x0 ? (xM - x0) / (x1 - x0) : 0;
    const temp = t0 + (t1 - t0) * Math.min(1, Math.max(0, frac));

    data.push({
      position: ((xM * 100) as number).toFixed(1), // cm
      // caller will assign configA/configB later
      configA: Number(temp.toFixed(2)),
      configB: Number(temp.toFixed(2)),
    });
  }

  return data;
}

export function ComparisonScreen() {
  const navigate = useNavigate();
  const currentParamsRaw = sessionStorage.getItem("simulationParams") || "null";
  const currentResultRaw = sessionStorage.getItem("simulationResult") || "null";

  // Memoize parsing so effects don't re-run on every render.
  const currentParams = useMemo(() => {
    try {
      return JSON.parse(currentParamsRaw) as SimulationParams | null;
    } catch {
      return null;
    }
  }, [currentParamsRaw]);

  const currentResult = useMemo(() => {
    try {
      return JSON.parse(currentResultRaw) as SimulationResult | null;
    } catch {
      return null;
    }
  }, [currentResultRaw]);

  const [idealResult, setIdealResult] = useState<SimulationResult | null>(null);
  const [idealMaterial, setIdealMaterial] = useState<string | null>(null);
  const [bestMaterial, setBestMaterial] = useState<{ name: string; k: number } | null>(null);
  const [idealParams, setIdealParams] = useState<SimulationParams | null>(null);
  const [error, setError] = useState<string>("");
  const [isConfigBApplied, setIsConfigBApplied] = useState(false);

  const cacheKey = useMemo(() => `v1:${currentParamsRaw}`, [currentParamsRaw]);

  const cached = useMemo(() => {
    try {
      const raw = sessionStorage.getItem("comparisonCache");
      if (!raw) return null;
      const obj = JSON.parse(raw) as any;
      return obj?.[cacheKey] ?? null;
    } catch {
      return null;
    }
  }, [cacheKey]);

  // If cached, hydrate immediately (eliminates loading).
  useEffect(() => {
    if (!cached) return;
    setBestMaterial(cached.bestMaterial ?? null);
    setIdealMaterial(cached.idealMaterial ?? null);
    setIdealParams(cached.idealParams ?? null);
    setIdealResult(cached.idealResult ?? null);
    setError("");
  }, [cached]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (!currentParams) throw new Error("Missing current simulation inputs.");
        if (cached) return;

        const materials = await apiFetch<Record<string, number>>("/api/materials");
        const entries = Object.entries(materials || {}).filter(([, v]) => typeof v === "number" && v > 0);
        if (!entries.length) throw new Error("No materials available in backend materials config.");

        // Best material = lowest-k (commonly ideal for insulation layers).
        const [bestName, bestK] = entries.reduce(
          (best, cur) => (cur[1] < best[1] ? cur : best),
          entries[0]
        );
        if (!cancelled) setBestMaterial({ name: bestName, k: bestK });

        // Optimized configuration: use best (lowest-k) material for the insulation (middle) layer only.
        const layers = currentParams.layers || [];
        const insulationIndex = layers.length >= 2 ? 1 : 0;
        const idealParams: SimulationParams = {
          ...currentParams,
          layers: layers.map((l, idx) =>
            idx === insulationIndex ? { ...l, k: bestK, material: bestName } : l
          ),
        };

        const res = await apiFetch<SimulationResult>("/api/compute", {
          method: "POST",
          json: idealParams,
        });

        if (cancelled) return;
        setIsConfigBApplied(false);
        setIdealParams(idealParams);
        setIdealMaterial(bestName);
        setIdealResult(res);

        // Persist cache locally and to backend state (survives refresh).
        const entry = {
          bestMaterial: { name: bestName, k: bestK },
          idealMaterial: bestName,
          idealParams,
          idealResult: res,
        };
        try {
          const prevRaw = sessionStorage.getItem("comparisonCache");
          const prev = prevRaw ? JSON.parse(prevRaw) : {};
          const next = { ...(prev || {}), [cacheKey]: entry };
          sessionStorage.setItem("comparisonCache", JSON.stringify(next));
          apiFetch("/api/state", { method: "PUT", json: { comparisonCache: next } }).catch(() => {});
        } catch {
          // ignore caching failures
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.details?.error || e?.message || "Failed to compute ideal configuration");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [currentParamsRaw, cacheKey, cached]);

  const derived = useMemo(() => {
    if (!currentParams || !currentResult || !idealResult) return null;
    const aFlux = currentResult.heat_flux;
    const bFlux = idealResult.heat_flux;
    const fluxReductionPct = aFlux !== 0 ? ((aFlux - bFlux) / aFlux) * 100 : null;

    const aR = currentResult.resistance;
    const bR = idealResult.resistance;
    const rIncreasePct = aR !== 0 ? ((bR - aR) / aR) * 100 : null;

    const profileA = buildTempProfile(currentParams, currentResult);
    const profileB = buildTempProfile(currentParams, idealResult);
    const chart = profileA.map((p, idx) => ({
      position: p.position,
      configA: p.configA,
      configB: profileB[idx]?.configB ?? p.configA,
    }));

    return {
      aFlux,
      bFlux,
      fluxReductionPct,
      aR,
      bR,
      rIncreasePct,
      chart,
    };
  }, [currentParams, currentResult, idealResult]);

  const usage = useMemo(() => readMaterialUsageStats(), []);

  const handleApplyConfigB = () => {
    if (!idealParams || !idealResult) return;
    // Apply only within Compare (show green line + optimized values).
    setIsConfigBApplied(true);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FB] py-8">
      <div className="max-w-[1440px] mx-auto px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <h1 className="text-3xl text-[#0A2540] mb-2">
            Configuration Comparison
          </h1>
          <p className="text-gray-600">
            Compare different material setups side-by-side to find the optimal solution
          </p>
        </motion.div>

        {!currentParams || !currentResult ? (
          <Card className="p-6 border-gray-200">
            <div className="text-lg text-[#0A2540] mb-2">No current simulation data</div>
            <div className="text-sm text-gray-600">Run a simulation first to compare configurations.</div>
          </Card>
        ) : error ? (
          <Card className="p-6 border-red-200 bg-red-50">
            <div className="text-lg text-red-900 mb-2">Comparison failed</div>
            <div className="text-sm text-red-800">{error}</div>
          </Card>
        ) : !derived ? (
          <Card className="p-6 border-gray-200">
            <div className="text-lg text-[#0A2540] mb-2">Computing ideal configuration…</div>
            <div className="text-sm text-gray-600">Fetching materials and running the backend solver.</div>
          </Card>
        ) : (
          <>
        {/* Recommendations / Popular */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <Card className="p-6 border-gray-200">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-[#3A86FF]" />
              <h2 className="text-lg text-[#0A2540]">Best Material Recommendation</h2>
            </div>
            {bestMaterial ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-[#0A2540]">
                  <span className="font-semibold">{bestMaterial.name}</span>
                </div>
                <div className="text-sm text-gray-600">
                  Suggested for insulation layer (lowest \(k\)):{" "}
                  <span className="font-semibold text-gray-800">{bestMaterial.k.toFixed(4)} W/m·K</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">Loading recommendation…</div>
            )}
          </Card>

          <Card className="p-6 border-gray-200">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <h2 className="text-lg text-[#0A2540]">Popular / Average Used</h2>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {usage.topMaterials.length ? (
                usage.topMaterials.map((m) => (
                  <div
                    key={m.name}
                    className="px-3 py-1 rounded-full bg-white border border-gray-200 text-sm text-gray-700"
                  >
                    {m.name} <span className="text-gray-500">({m.count})</span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-600">Run a few simulations to see popular materials here.</div>
              )}
            </div>
            <div className="text-sm text-gray-600">
              Average layer \(k\) across your runs:{" "}
              <span className="font-semibold text-gray-800">
                {usage.averageK === null ? "—" : `${usage.averageK.toFixed(4)} W/m·K`}
              </span>
            </div>
          </Card>
        </div>

        {/* Comparison Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Configuration A */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card className="p-6 border-2 border-blue-200 bg-blue-50">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl text-[#0A2540]">Configuration A (Current)</h2>
                <div className="px-3 py-1 bg-blue-600 text-white text-sm rounded-full">
                  Current
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white rounded-lg">
                    <div className="text-sm text-gray-600 mb-1">Heat Flux</div>
                    <div className="text-2xl text-[#0A2540]">{derived.aFlux.toFixed(2)} W/m²</div>
                  </div>
                  <div className="p-4 bg-white rounded-lg">
                    <div className="text-sm text-gray-600 mb-1">Resistance</div>
                    <div className="text-2xl text-[#0A2540]">{derived.aR.toFixed(3)}</div>
                  </div>
                </div>

                <div className="p-4 bg-white rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">Material</div>
                  <div className="text-3xl text-[#0A2540]">Current</div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Configuration B */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="p-6 border-2 border-green-200 bg-green-50">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl text-[#0A2540]">Configuration B (Recommended layer)</h2>
                <div className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-sm rounded-full">
                  <Award className="w-3 h-3" />
                  Optimized
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white rounded-lg">
                    <div className="text-sm text-gray-600 mb-1">Heat Flux</div>
                    <div className="text-2xl text-green-600">{derived.bFlux.toFixed(2)} W/m²</div>
                    {derived.fluxReductionPct !== null && (
                      <div className="text-sm text-green-600 mt-1">↓ {derived.fluxReductionPct.toFixed(1)}% better</div>
                    )}
                  </div>
                  <div className="p-4 bg-white rounded-lg">
                    <div className="text-sm text-gray-600 mb-1">Resistance</div>
                    <div className="text-2xl text-green-600">{derived.bR.toFixed(3)}</div>
                    {derived.rIncreasePct !== null && (
                      <div className="text-sm text-green-600 mt-1">↑ {derived.rIncreasePct.toFixed(1)}% better</div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-white rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">Ideal Material</div>
                  <div className="text-3xl text-green-600">{idealMaterial || "Best available"}</div>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>

        {/* Comparison Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Card className="p-8 border-gray-200">
            <h2 className="text-xl text-[#0A2540] mb-6">Temperature Profile Comparison</h2>

            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={derived.chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="position" 
                  label={{ value: 'Position (cm)', position: 'insideBottom', offset: -5 }}
                  stroke="#6b7280"
                />
                <YAxis 
                  label={{ value: 'Temperature (°C)', angle: -90, position: 'insideLeft' }}
                  stroke="#6b7280"
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="configA" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  name="Configuration A (Current)"
                  dot={false}
                />
                {isConfigBApplied && (
                  <Line
                    type="monotone"
                    dataKey="configB"
                    stroke="#22c55e"
                    strokeWidth={3}
                    name="Configuration B (Optimized)"
                    dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>

        {/* Key Insights */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-8"
        >
          <Card className="p-8 border-gray-200">
            <h2 className="text-xl text-[#0A2540] mb-6">Key Insights</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 bg-green-50 rounded-lg border border-green-200">
                <div className="text-3xl text-green-600 mb-2">
                  {derived.fluxReductionPct === null ? "—" : `${derived.fluxReductionPct.toFixed(0)}%`}
                </div>
                <div className="text-sm text-gray-700 mb-2">Heat Flux Reduction</div>
                <div className="text-xs text-gray-600">
                  Configuration B reduces heat flux from {derived.aFlux.toFixed(2)} to {derived.bFlux.toFixed(2)} W/m²
                </div>
              </div>

              <div className="p-6 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-3xl text-blue-600 mb-2">
                  {derived.rIncreasePct === null ? "—" : `${derived.rIncreasePct.toFixed(0)}%`}
                </div>
                <div className="text-sm text-gray-700 mb-2">Resistance Improvement</div>
                <div className="text-xs text-gray-600">
                  Total resistance increased from {derived.aR.toFixed(3)} to {derived.bR.toFixed(3)} m²·K/W
                </div>
              </div>

              <div className="p-6 bg-purple-50 rounded-lg border border-purple-200">
                <div className="text-3xl text-purple-600 mb-2">{idealMaterial || "Best"}</div>
                <div className="text-sm text-gray-700 mb-2">Ideal Material Used</div>
                <div className="text-xs text-gray-600">
                  Optimized configuration uses the single best (lowest-k) material from the backend materials list.
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <Button
                className="bg-[#3A86FF] hover:bg-[#2A76EF] text-white px-8"
                onClick={handleApplyConfigB}
                disabled={!idealParams || !idealResult || isConfigBApplied}
              >
                {isConfigBApplied ? "Configuration B Applied" : "Apply Configuration B"}
              </Button>
            </div>
          </Card>
        </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
