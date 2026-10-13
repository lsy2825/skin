// app/data.json keeps the price rows as columns (build2/appdata.py columns); tests that read the file get rows back
module.exports = (D) => {
  if (D.rows) return D;
  const c = D.cols.map((x) => x.slice()), n = c[0].length;
  for (const f of D.colDelta || []) { let a = 0; for (let j = 0; j < n; j++) c[f][j] = a += c[f][j]; }
  D.rows = Array.from({ length: n }, (_, j) => c.map((x) => x[j]));
  delete D.cols; delete D.colDelta;
  return D;
};
