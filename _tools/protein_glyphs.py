"""Build assets/js/proteins.js: real PDB C-alpha traces laid out along the strokes of "Ari".

Usage (from a folder containing the .pdb files, e.g. downloaded from
https://files.rcsb.org/download/1C1G.pdb):

    python3 protein_glyphs.py path/to/assets/js/proteins.js

Each piece is (PDB id, chain, residue range, label, stroke start, stroke end) with
strokes in glyph-relative units (0..1 across the ink bounds of "Ari" set in
Instrument Serif italic). The structure is rotated (never mirrored) so its long
axis follows the stroke and centered on it; one global scale (H_A) is used for all.
"""
import json, math, sys
H_A = 118.0                      # glyph ink height in angstroms
ASPECT = 550 / 353              # glyph ink bbox width / height (Instrument Serif italic "Ari")
W_A = H_A * ASPECT

# Each piece is one real assembly laid along one stroke:
#   (pdb, [(chain, first, last, biomt operator or None), ...], label, stroke start (u,v), stroke end (u,v) or None, view)
# view "narrow": look across the assembly's middle axis so bundled chains overlap (coiled coils read as one rope)
# view ("axis", a, b, c, d): orient by anatomy instead of overall shape: residues a..b (first chain) run along
#   the stroke, and residues c..d point to the right-hand side of it
# Every entry is used whole: all chains of the deposited structure (or of its
# biological assembly), with no residues trimmed.
PIECES = [
  ("1IC2", [("A", 1, 999, None), ("B", 1, 999, None)], "Tropomyosin N-terminal coiled coil (dimer 1)", (0.09, 0.91), (0.32, 0.10), "narrow"),
  ("1IC2", [("C", 1, 999, None), ("D", 1, 999, None)], "Tropomyosin N-terminal coiled coil (dimer 2)", (0.352, 0.07), (0.338, 0.94), "narrow"),
  ("2MAG", [("A", 1, 999, None)],                       "Magainin 2",              (0.205, 0.64), (0.318, 0.64), "wide"),
  ("2KB7", [("P", 1, 999, None)],                       "Phospholamban",           (0.582, 0.39), (0.509, 1.02), ("axis", 24, 53, 1, 19)),
  ("1KQL", [("A", 1, 999, None), ("B", 1, 999, None)], "Tropomyosin C-terminal coiled coil", (0.918, 0.34), (0.857, 0.92), "narrow"),
  ("1L2Y", [("A", 1, 999, None)],                       "Trp-cage",                (0.912, 0.105), None,          "wide"),
]

def sub(a,b): return [a[i]-b[i] for i in range(3)]
def add(a,b): return [a[i]+b[i] for i in range(3)]
def mul(a,s): return [x*s for x in a]
def dot(a,b): return sum(a[i]*b[i] for i in range(3))
def cross(a,b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def norm(a):
    l = math.sqrt(dot(a,a)) or 1.0
    return [x/l for x in a]

def pca(pts):
    c = [sum(p[i] for p in pts)/len(pts) for i in range(3)]
    X = [sub(p,c) for p in pts]
    C = [[sum(x[i]*x[j] for x in X)/len(X) for j in range(3)] for i in range(3)]
    vecs = []
    M = [row[:] for row in C]
    for _ in range(3):                       # power iteration + deflation
        v = norm([1.0, 0.7, 0.3])
        for _ in range(500):
            v = norm([sum(M[i][j]*v[j] for j in range(3)) for i in range(3)])
        lam = dot(v, [sum(M[i][j]*v[j] for j in range(3)) for i in range(3)])
        for i in range(3):
            for j in range(3): M[i][j] -= lam*v[i]*v[j]
        vecs.append(v)
    if dot(cross(vecs[0], vecs[1]), vecs[2]) < 0: vecs[2] = mul(vecs[2], -1)   # keep it a rotation
    return c, vecs

def biomt(pid, op):
    rows = {}
    for l in open(pid + ".pdb"):
        f = l.split()
        if l.startswith("REMARK 350") and len(f) >= 8 and f[2] in ("BIOMT1", "BIOMT2", "BIOMT3"):
            if int(f[3]) == op: rows[int(f[2][-1])] = [float(x) for x in f[4:8]]
    return [rows[1], rows[2], rows[3]]

def load(pid, ch, a, b, op=None):
    L = open(pid + ".pdb").read().splitlines()
    ca = {}
    for l in L:
        if l.startswith("ENDMDL"): break
        if l.startswith("ATOM") and l[12:16].strip() == "CA" and l[21] == ch and l[16] in " A":
            n = int(l[22:26])
            if a <= n <= b and n not in ca: ca[n] = [float(l[30:38]), float(l[38:46]), float(l[46:54])]
    if op:
        M = biomt(pid, op)
        ca = {n: [sum(M[i][j]*v[j] for j in range(3)) + M[i][3] for i in range(3)] for n, v in ca.items()}
    ss = {}
    for l in L:
        if l.startswith("HELIX") and l[19] == ch:
            for n in range(int(l[21:25]), int(l[33:37]) + 1): ss[n] = 1
        if l.startswith("SHEET") and l[21] == ch:
            for n in range(int(l[22:26]), int(l[33:37]) + 1): ss[n] = 2
    nums = sorted(ca)
    return [ca[n] for n in nums], [ss.get(n, 0) for n in nums], nums

def frames(Q, SS):
    """Per-residue ribbon width direction W (= T x N) and normal N, kept consistent within each element."""
    n = len(Q); W, N = [], []
    for i in range(n):
        i0, i2 = max(i-1, 0), min(i+1, n-1)
        T = norm(sub(Q[i2], Q[i0]))
        Nv = norm(sub(Q[i], mul(add(Q[i0], Q[i2]), 0.5))) if 0 < i < n-1 else (N[-1] if N else [0, 0, -1])
        if SS[i] == 2 and i and SS[i-1] == 2 and dot(Nv, N[-1]) < 0: Nv = mul(Nv, -1)   # strand pleat
        Wv = norm(cross(T, Nv))
        if i and SS[i] and SS[i] == SS[i-1] and dot(Wv, W[-1]) < 0: Wv = mul(Wv, -1)
        W.append(Wv); N.append(Nv)
    return W, N

out = []
seg_id = 0
for gi, (pid, parts, name, s0, s1, view) in enumerate(PIECES):
    chains = [load(pid, ch, a, b, op) for ch, a, b, op in parts]
    allP = [p for P, _, _ in chains for p in P]
    c, (e1, e2, e3) = pca(allP)
    first = chains[0][0]
    if dot(sub(first[-1], first[0]), e1) < 0: e1 = mul(e1, -1); e2 = mul(e2, -1)
    if view == "narrow":   # (e1, e3, -e2) is still right-handed: a rotation, never a mirror
        e2, e3 = e3, mul(e2, -1)
    side = 1
    if isinstance(view, tuple) and view[0] == "axis":
        _, a0, a1, b0, b1 = view
        P0, _, N0 = chains[0]
        A = [P0[i] for i, n in enumerate(N0) if a0 <= n <= a1]
        B = [P0[i] for i, n in enumerate(N0) if b0 <= n <= b1]
        _, (ax, _, _) = pca(A)
        if dot(sub(A[-1], A[0]), ax) < 0: ax = mul(ax, -1)
        ca_ = [sum(p[i] for p in A)/len(A) for i in range(3)]
        cb_ = [sum(p[i] for p in B)/len(B) for i in range(3)]
        off = sub(cb_, ca_); off = sub(off, mul(ax, dot(off, ax)))
        e1, e2 = ax, norm(off); e3 = cross(e1, e2)
        c = [sum(p[i] for p in A)/len(A) for i in range(3)]   # centre the stroke on the aligned part
        side = -1   # put e2 on the stroke's right: (E1, -E2, -E3) is still a rotation
    if s1 is None:
        d = [1.0, 0.0]; mid = s0
    else:
        dx, dy = (s1[0]-s0[0]) * W_A, (s1[1]-s0[1]) * H_A
        l = math.hypot(dx, dy); d = [dx/l, dy/l]
        mid = ((s0[0]+s1[0])/2, (s0[1]+s1[1])/2)
    E1 = [d[0], d[1], 0.0]; E2 = [-d[1] * side, d[0] * side, 0.0]; E3 = [0.0, 0.0, 1.0 * side]   # x right, y down, z into screen
    def rot(v):
        a1, a2, a3 = dot(v, e1), dot(v, e2), dot(v, e3)
        return [a1*E1[i] + a2*E2[i] + a3*E3[i] for i in range(3)]
    total = sum(len(P) for P, _, _ in chains); done = 0
    for ci, (P, SS, nums) in enumerate(chains):
        Q = [rot(sub(p, c)) for p in P]
        W, N = frames(Q, SS)
        res = []
        for i in range(len(P)):
            if SS[i] and (i == 0 or SS[i-1] != SS[i]): seg_id += 1
            res.append([round(mid[0] + Q[i][0]/W_A, 5), round(mid[1] + Q[i][1]/H_A, 5), round(Q[i][2], 3),
                        round(W[i][0], 3), round(W[i][1], 3), round(N[i][2], 3), SS[i], seg_id if SS[i] else -1,
                        round((done + i) / max(1, total - 1), 4)])
        done += len(P)
        out.append({"name": name, "pdb": pid, "group": gi, "part": ci,
                    "residues": "%s %d–%d" % (parts[ci][0], nums[0], nums[-1]), "res": res})
    Qall = [rot(sub(p, c)) for p in allP]
    ext = [round(max(q[k] for q in Qall) - min(q[k] for q in Qall), 1) for k in range(3)]
    print("%-5s %-26s chains=%d n=%d size(Å) %s" % (pid, name, len(chains), total, ext), file=sys.stderr)

js = "// Generated from RCSB PDB C-alpha coordinates and HELIX/SHEET records (see README).\n"
js += "window.PROTEIN_GLYPHS = " + json.dumps({"Ari": {"heightA": H_A, "chains": out}}, ensure_ascii=False, separators=(",", ":")) + ";\n"
open(sys.argv[1], "w").write(js)
