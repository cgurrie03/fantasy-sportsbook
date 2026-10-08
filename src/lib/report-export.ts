// Keep export libraries out of the sportsbook's initial bundle.
export async function exportReport(
  node: HTMLElement,
  filename: string,
  format: "png" | "pdf",
) {
  const { toCanvas } = await import("html-to-image");
  const clone = node.cloneNode(true) as HTMLElement;
  const holder = document.createElement("div");
  holder.className = "admin-workspace reports report-export-host";
  holder.style.cssText =
    "position:fixed;left:-20000px;top:0;width:1200px;padding:24px;z-index:-1;";
  holder.style.background =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--bg")
      .trim() || "#0d1524";
  holder.append(clone);
  document.body.append(holder);
  try {
    await Promise.all(
      [...clone.querySelectorAll<HTMLImageElement>("img")].map(async (img) => {
        try {
          // Vite's local preview does not run Vercel API functions.
          if (import.meta.env.DEV)
            throw new Error("Local avatar proxy unavailable");
          const source = new URL(img.src);
          if (source.hostname !== "sleepercdn.com")
            throw new Error("Unsupported avatar source");
          const response = await fetch(
            `/api/report-avatar?path=${encodeURIComponent(source.pathname)}`,
            { signal: AbortSignal.timeout(10000) },
          );
          if (
            !response.ok ||
            !response.headers.get("content-type")?.startsWith("image/")
          )
            throw new Error("Avatar unavailable");
          const blob = await response.blob();
          img.src = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {
          const initial = document.createElement("span");
          initial.className = "report-avatar-initial";
          initial.textContent = (img.parentElement?.textContent?.trim() ?? "?")
            .slice(0, 1)
            .toUpperCase();
          img.replaceWith(initial);
        }
      }),
    );
    // A report image is a readable summary; the CSV retains every detailed row.
    clone.querySelectorAll("tbody").forEach((body) => {
      const rows = [...body.querySelectorAll("tr")];
      if (rows.length > 40) {
        rows.slice(40).forEach((row) => row.remove());
        const note = document.createElement("p");
        note.className = "report-note";
        note.textContent = `Showing the first 40 of ${rows.length} detail rows. Export CSV for all rows.`;
        body.closest("table")?.parentElement?.append(note);
      }
    });
    clone.querySelectorAll<HTMLElement>(".report-table-wrap").forEach((el) => {
      el.style.overflow = "visible";
    });
    const heatmap = clone.querySelector<HTMLTableElement>(".score-heatmap");
    const weekColumns = heatmap
      ? heatmap.rows[0].cells.length -
        1 -
        heatmap.rows[0].querySelectorAll("[data-summary]").length
      : 0;
    if (format === "pdf" && heatmap && weekColumns > 5) {
      const columns = weekColumns + 1;
      for (let start = 1; start < columns; start += 5) {
        const part = heatmap.cloneNode(true) as HTMLTableElement;
        for (const row of [...part.rows])
          [...row.cells].forEach((cell, i) => {
            if (i !== 0 && i < columns && (i < start || i >= start + 5))
              cell.remove();
          });
        const label = document.createElement("p");
        label.className = "report-note";
        label.textContent = `${heatmap.rows[0].cells[start].textContent?.trim()} through ${heatmap.rows[0].cells[Math.min(columns - 1, start + 4)].textContent?.trim()}`;
        heatmap.before(label, part);
      }
      heatmap.remove();
    }
    const exportWidth =
      format === "png"
        ? Math.max(
            1200,
            ...[...clone.querySelectorAll<HTMLElement>("table")].map(
              (el) => el.scrollWidth + 96,
            ),
          )
        : 1200;
    holder.style.width = `${exportWidth}px`;
    await document.fonts.ready;
    const breakpoints = [
      ...clone.querySelectorAll("tr, figure, .report-heading, .report-kpis"),
    ]
      .map((el) =>
        Math.round(
          el.getBoundingClientRect().top - holder.getBoundingClientRect().top,
        ),
      )
      .filter((y) => y > 0)
      .sort((a, b) => a - b);
    const canvas = await toCanvas(holder, {
      pixelRatio: Math.min(
        1.5,
        Math.sqrt(20_000_000 / (exportWidth * holder.scrollHeight)),
      ),
      width: exportWidth,
      style: {
        position: "static",
        left: "0",
        top: "0",
        zIndex: "auto",
        margin: "0",
      },
      backgroundColor: holder.style.background,
      imagePlaceholder:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Ccircle cx='18' cy='18' r='18' fill='%232c415b'/%3E%3C/svg%3E",
    });
    if (format === "png") {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Image export failed."))),
          "image/png",
        ),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${filename}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } else {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });
      const width = 277,
        height = 185,
        scale = width / canvas.width;
      const maxPixels = Math.floor(height / scale);
      const boundaries = breakpoints.map((y) =>
        Math.round(y * (canvas.width / exportWidth)),
      );
      let offset = 0,
        page = 0;
      while (offset < canvas.height) {
        const limit = Math.min(canvas.height, offset + maxPixels);
        const end =
          limit === canvas.height
            ? limit
            : (boundaries
                .filter((y) => y > offset + maxPixels * 0.5 && y <= limit)
                .at(-1) ?? limit);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = end - offset;
        slice
          .getContext("2d")!
          .drawImage(
            canvas,
            0,
            offset,
            canvas.width,
            slice.height,
            0,
            0,
            canvas.width,
            slice.height,
          );
        if (page++) pdf.addPage();
        pdf.addImage(
          slice.toDataURL("image/png"),
          "PNG",
          10,
          10,
          width,
          slice.height * scale,
        );
        pdf.setFontSize(8);
        pdf.setTextColor(110);
        pdf.text(`${filename} · Page ${page}`, 10, 203);
        offset = end;
      }
      pdf.save(`${filename}.pdf`);
    }
  } finally {
    holder.remove();
  }
}
