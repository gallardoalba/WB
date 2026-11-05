/**
 * Impresión de tarjetas sueltas (etiqueta del envío y código de entrega).
 *
 * Se clona el nodo en un iframe oculto en vez de usar `window.print()` sobre la
 * página: así solo sale lo que hace falta, sin la interfaz, y no depende de
 * reglas `@media print` que el diálogo (montado en un portal) complica. El nodo
 * se copia tal cual —nunca se interpola HTML—, así que un nombre con ángulos no
 * puede inyectar nada.
 */
const PRINT_STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16mm 14mm;
    font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
    color: #1c211d;
    background: #fff;
  }
  [data-print-sheet] {
    border: 1px solid #9aa39b;
    border-radius: 6px;
    padding: 10mm 8mm;
    margin: 0 0 8mm;
    page-break-inside: avoid;
  }
  [data-print-sheet] p {
    margin: 0 0 2mm;
    font-size: 12pt;
    line-height: 1.35;
  }
  [data-print-sheet] .post-label-service {
    font-weight: 700;
    letter-spacing: 0.08em;
    margin-bottom: 4mm;
  }
  [data-print-sheet] .post-label-name,
  [data-print-sheet] strong {
    font-size: 14pt;
    font-weight: 700;
  }
  [data-print-sheet] .post-label-sender {
    margin-top: 5mm;
    font-size: 9pt;
    color: #4a534c;
  }
  [data-print-sheet] .handover-code-value {
    display: block;
    font-size: 26pt;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-align: center;
    margin-top: 4mm;
  }
  [data-print-sheet] img {
    display: block;
    margin: 0 auto;
    width: 40mm;
    height: 40mm;
  }
  [data-print-sheet] ol {
    margin: 3mm 0 0;
    padding-left: 6mm;
    font-size: 12pt;
    line-height: 1.5;
  }
`;

/** Imprime (sin abrir ventanas) todo lo marcado con `data-print-sheet`. */
export function printSheets(selector = "[data-print-sheet]"): void {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (nodes.length === 0) return;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }

  const style = doc.createElement("style");
  style.textContent = PRINT_STYLES;
  doc.head.appendChild(style);
  for (const node of nodes) doc.body.appendChild(node.cloneNode(true));

  const clean = () => window.setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", clean, { once: true });
  // Imprimir requiere que el documento tenga tamaño; el foco evita que Safari
  // se quede con la ventana anterior.
  frame.style.width = "1px";
  frame.style.height = "1px";
  win.focus();
  win.print();
  // Respaldo por si el navegador no dispara `afterprint` (impresión cancelada).
  window.setTimeout(clean, 60_000);
}
