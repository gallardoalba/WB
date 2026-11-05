import { ImageResponse } from "next/og";

export const alt = "Wanderbibliothek: Bücher, die weiterreisen";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#2f5741",
          color: "#f7f6f1",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 34 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#f7f6f1",
              color: "#2f5741",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            B2
          </div>
          <span>Wanderbibliothek</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 82, fontWeight: 700, lineHeight: 1.05 }}>
            Libros que siguen viajando
          </div>
          <div style={{ display: "flex", fontSize: 32, opacity: 0.85 }}>
            Comparte, descubre e intercambia libros en toda Alemania
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, opacity: 0.8 }}>
          <span>Comunidad de lectura</span>
          <span>Sin ánimo de lucro</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
