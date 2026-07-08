import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Competitor, Metro, ScoreResult, TopSite, Zcta } from "../api";
import { composite } from "../lib/score";
import type { SubScores } from "../api";
import { POI_COLOR } from "../lib/score";

export type OverlayMetric =
  | "weighted_score" | "med_income" | "pop_density" | "competitor_density" | "opportunity_score";

interface MapViewProps {
  metro: Metro | null;
  zctas: Zcta[];
  competitors: Competitor[];
  weights: SubScores;
  overlayMetric: OverlayMetric;
  showOverlay: boolean;
  showCompetitors: boolean;
  topSites: TopSite[];
  selectedResult: ScoreResult | null;
  onMapClick: (lat: number, lng: number) => void;
}

// Free, keyless, no-token raster basemap (OpenStreetMap data via CARTO).
const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 20,
    },
  },
  layers: [{ id: "carto-base", type: "raster", source: "carto" }],
};

const METRIC_FIELD: Record<OverlayMetric, string> = {
  weighted_score: "weighted_score",
  med_income: "med_income",
  pop_density: "pop_density",
  competitor_density: "competitor_density",
  opportunity_score: "opportunity_score",
};

function zctasToGeoJSON(zctas: Zcta[], weights: SubScores): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zctas.map((z) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [z.lng, z.lat] },
      properties: {
        zcta: z.zcta,
        metro: z.metro,
        weighted_score: composite(z.subscores, weights),
        med_income: z.med_income,
        pop_density: z.pop_density,
        competitor_density: z.competitor_density,
        opportunity_score: z.opportunity_score,
        population: z.population,
        competitors: z.competitors,
        cluster_label: z.cluster_label,
      },
    })),
  };
}

function competitorsToGeoJSON(comps: Competitor[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: comps.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: { type: c.type, name: c.name || c.type },
    })),
  };
}

function topSitesToGeoJSON(sites: TopSite[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sites.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { rank: s.rank, zcta: s.zcta, score: s.site_score },
    })),
  };
}

export function MapView({
  metro, zctas, competitors, weights, overlayMetric, showOverlay, showCompetitors,
  topSites, selectedResult, onMapClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [loaded, setLoaded] = useState(false);

  // init once
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-97.74, 30.27],
      zoom: 10,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

    map.on("load", () => {
      // ---- ZCTA overlay: heatmap surface + graduated point layer ----
      map.addSource("zctas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "zcta-heat", type: "heatmap", source: "zctas",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "metric_norm"], 0, 0, 1, 1],
          "heatmap-intensity": 0.9,
          "heatmap-radius": 34,
          "heatmap-opacity": 0.55,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(252,252,251,0)",
            0.2, "#cde2fb",
            0.4, "#86b6ef",
            0.6, "#3987e5",
            0.8, "#1c5cab",
            1, "#0d366b",
          ],
        },
      });
      map.addLayer({
        id: "zcta-points", type: "circle", source: "zctas",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 8],
          "circle-color": [
            "interpolate", ["linear"], ["get", "metric_norm"],
            0, "#9ec5f4", 0.5, "#3987e5", 1, "#0d366b",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });

      // ---- competitors: clustered ----
      map.addSource("competitors", {
        type: "geojson", data: { type: "FeatureCollection", features: [] },
        cluster: true, clusterRadius: 44, clusterMaxZoom: 13,
      });
      map.addLayer({
        id: "comp-clusters", type: "circle", source: "competitors",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#e34948",
          "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 14, 25, 20, 100, 26],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "comp-cluster-count", type: "symbol", source: "competitors",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "comp-points", type: "circle", source: "competitors",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 4.5,
          "circle-color": [
            "match", ["get", "type"],
            "restaurant", POI_COLOR.restaurant,
            "fast_food", POI_COLOR.fast_food,
            "cafe", POI_COLOR.cafe,
            "#2a78d6",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });

      // ---- top-site numbered markers ----
      map.addSource("top-sites", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "top-site-bg", type: "circle", source: "top-sites",
        paint: {
          "circle-radius": 12,
          "circle-color": "#4a3aa7",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "top-site-label", type: "symbol", source: "top-sites",
        layout: { "text-field": ["get", "rank"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
        paint: { "text-color": "#ffffff" },
      });

      // ---- selected click point ----
      map.addSource("selected", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "selected-ring", type: "circle", source: "selected",
        paint: {
          "circle-radius": 16, "circle-color": "#eda100", "circle-opacity": 0.25,
        },
      });
      map.addLayer({
        id: "selected-point", type: "circle", source: "selected",
        paint: {
          "circle-radius": 7, "circle-color": "#eda100",
          "circle-stroke-width": 2, "circle-stroke-color": "#0b0b0b",
        },
      });

      setLoaded(true);
    });

    map.on("click", (e) => {
      // ignore clicks landing on interactive layers so competitor/site popups don't fight the score-click
      onMapClick(e.lngLat.lat, e.lngLat.lng);
    });
    map.on("mouseenter", "comp-points", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "comp-points", () => (map.getCanvas().style.cursor = ""));

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on("mouseenter", "comp-points", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const props = f.properties as { name?: string; type?: string };
      popup
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(`<strong>${props.name || props.type}</strong><br/>${props.type}`)
        .addTo(map);
    });
    map.on("mouseleave", "comp-points", () => popup.remove());

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fly to metro
  useEffect(() => {
    if (!loaded || !metro || !mapRef.current) return;
    const [lat, lng] = metro.center;
    mapRef.current.flyTo({ center: [lng, lat], zoom: 10.4, duration: 900 });
  }, [metro, loaded]);

  // update zcta overlay data (normalise selected metric 0-1 for color/heat weight)
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const fc = zctasToGeoJSON(zctas, weights);
    const field = METRIC_FIELD[overlayMetric];
    const values = fc.features.map((f) => f.properties![field] as number);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    fc.features.forEach((f) => {
      const v = f.properties![field] as number;
      f.properties!.metric_norm = max > min ? (v - min) / (max - min) : 0.5;
    });
    const src = mapRef.current.getSource("zctas") as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);
    if (mapRef.current.getLayer("zcta-heat")) {
      mapRef.current.setLayoutProperty("zcta-heat", "visibility", showOverlay ? "visible" : "none");
      mapRef.current.setLayoutProperty("zcta-points", "visibility", showOverlay ? "visible" : "none");
    }
  }, [zctas, weights, overlayMetric, showOverlay, loaded]);

  // update competitors
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const src = mapRef.current.getSource("competitors") as maplibregl.GeoJSONSource | undefined;
    src?.setData(competitorsToGeoJSON(competitors));
    ["comp-clusters", "comp-cluster-count", "comp-points"].forEach((id) => {
      if (mapRef.current!.getLayer(id)) {
        mapRef.current!.setLayoutProperty(id, "visibility", showCompetitors ? "visible" : "none");
      }
    });
  }, [competitors, showCompetitors, loaded]);

  // update top sites
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const src = mapRef.current.getSource("top-sites") as maplibregl.GeoJSONSource | undefined;
    src?.setData(topSitesToGeoJSON(topSites));
  }, [topSites, loaded]);

  // update selected point
  useEffect(() => {
    if (!loaded || !mapRef.current) return;
    const src = mapRef.current.getSource("selected") as maplibregl.GeoJSONSource | undefined;
    const fc: GeoJSON.FeatureCollection = selectedResult
      ? {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            geometry: { type: "Point", coordinates: [selectedResult.lng, selectedResult.lat] },
            properties: {},
          }],
        }
      : { type: "FeatureCollection", features: [] };
    src?.setData(fc);
  }, [selectedResult, loaded]);

  return <div ref={containerRef} className="map-container" />;
}
