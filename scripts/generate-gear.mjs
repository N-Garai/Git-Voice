/**
 * Generates a real gear silhouette path (teeth on a circle, using a
 * trapezoid tooth profile blended on the outer arc).
 *
 * Profile: teeth alternate between root radius (r1) and tip radius (r2).
 * Each tooth: land at tip, flank down, valley at root.
 */
function gearPath(cx, cy, r1, r2, teeth) {
  const pitch = (Math.PI * 2) / teeth;
  const landFrac = 0.34;
  const flankFrac = 0.16;

  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = i * pitch;
    pts.push({ r: r2, a: a0 });
    pts.push({ r: r2, a: a0 + landFrac * pitch });
    pts.push({ r: r1, a: a0 + (landFrac + flankFrac) * pitch });
    pts.push({ r: r1, a: a0 + (1 - flankFrac) * pitch });
  }

  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const x = cx + p.r * Math.cos(p.a);
    const y = cy + p.r * Math.sin(p.a);
    const next = pts[(i + 1) % pts.length];
    const nx = cx + next.r * Math.cos(next.a);
    const ny = cy + next.r * Math.sin(next.a);
    const sameR = Math.abs(p.r - next.r) < 1e-6;

    if (i === 0) d += `M${x.toFixed(2)} ${y.toFixed(2)}`;
    if (sameR) {
      d += ` A${p.r} ${p.r} 0 0 1 ${nx.toFixed(2)} ${ny.toFixed(2)}`;
    } else {
      d += ` L${nx.toFixed(2)} ${ny.toFixed(2)}`;
    }
  }
  d += " Z";
  return d;
}

// Boot loader: big gear r1=46 r2=58, 9 teeth, plus small pinion r1=14 r2=19, 8 teeth.
console.log("// big gear path (200x200 viewBox, center 100,100):");
console.log(gearPath(100, 100, 46, 58, 9));
console.log("// small pinion (center ~152,152):");
console.log(gearPath(152, 152, 14, 19, 8));
// Favicon: 64x64, center 32,32.
console.log("// favicon big gear (64x64, center 32,32):");
console.log(gearPath(32, 32, 17, 22, 9));
console.log("// favicon pinion (center ~46,47):");
console.log(gearPath(46, 47, 6.2, 8.8, 8));
