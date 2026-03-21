# Produce HTML Document

Produces standalone, print-ready HTML documents for technical teams and executive audiences. Two document types are established and validated: **pitch/overview** and **technical reference**. Both share one design system.

## When to Use

Any time a standalone HTML document is needed — pitch decks, technical overviews, architecture summaries, logic references, capability assessments. The document must be readable in a browser and print cleanly to PDF. Do not use this skill for React apps or interactive UIs — this is for authored, document-style content.

---

## The Two Document Types

Choose the type before writing a line of HTML. They share the same design system but have different registers, different dominant components, and different content hierarchies.

### Type A — Pitch / Overview

**Audience:** External, executive, mixed technical/non-technical.
**Purpose:** Establish credibility, communicate value, drive a next action.
**Register:** Editorial. Narrative-driven. Stat-forward. Confident.
**Dominant components:** Large stat numbers, callout blocks, Mermaid diagrams, trace blocks, guarantee lists.
**Example:** `RxReverse/docs/rxreverse-overview.html`

Rules for Type A:
- Lead sections with a clear human problem, not a technical description
- Use large display numbers (`.guarantee-num`, `.tier-stat`) for key metrics — they create editorial weight
- Use `.callout-warning` to surface the tension before explaining the solution
- Mermaid diagrams belong here but should show flow and relationships, not exhaustive detail
- Prose should read cleanly out loud — no jargon without explanation
- The audience should finish each section knowing *what it means for them*

### Type B — Technical Reference

**Audience:** Internal engineers and architects; technical partners reviewing the system.
**Purpose:** Complete, accurate, authoritative reference for how the system works.
**Register:** Dense. Table-forward. No marketing language.
**Dominant components:** Step tables, badge system, rule blocks, ref grids, phase strips.
**Example:** `RxReverse/docs/adjudication-logic-reference.html`

Rules for Type B:
- Tables over prose wherever a table works — they scan faster and are harder to misread
- Every section should be self-contained: someone reading only section 5 gets what they need
- Big picture first (diagram + overview table), then detail panels below
- Badges communicate category and severity at a glance — use them consistently
- Rule blocks (left-accent callouts) surface invariants and non-obvious constraints
- Step number columns in DM Mono make long tables navigable

---

## Design System

### Head Template

Copy this exactly. The three fonts are load-order sensitive. Mermaid must be initialized with these theme variables.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;0,8..60,600;1,8..60,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({
    startOnLoad: true,
    theme: 'neutral',
    flowchart: { curve: 'linear', padding: 16 },
    themeVariables: {
      fontFamily: '"DM Mono", monospace',
      fontSize: '12px',
      primaryColor: '#edf1f8',
      primaryBorderColor: '#1c4a7a',
      primaryTextColor: '#1a1714',
      lineColor: '#8a8278',
      secondaryColor: '#f0ece4',
      tertiaryColor: '#fafaf8',
      edgeLabelBackground: '#fafaf8',
    }
  });
</script>
```

### CSS Variables

These are the complete color tokens. Never hardcode colors — always use these variables. The ink scale runs from near-black to light gray. Paper is warm off-white. Accent is dark navy. Warn is amber.

```css
:root {
  --ink:        #1a1714;   /* near-black — headings, strong text */
  --ink-mid:    #3d3830;   /* body text */
  --ink-light:  #5c554c;   /* secondary text, captions */
  --ink-faint:  #8a8278;   /* metadata, labels, borders */
  --paper:      #fafaf8;   /* warm off-white — diagram bg, pre blocks */
  --rule:       #d8d4cc;   /* table rules, borders */
  --rule-heavy: #1a1714;   /* table header rules */
  --accent:     #1c4a7a;   /* dark navy — links, step numbers, left borders */
  --accent-bg:  #edf1f8;   /* light blue — callouts, diagram nodes */
  --warn:       #8b5e0a;   /* amber — warning callouts */
  --warn-bg:    #fdf6ed;   /* light amber bg */
  --green:      #1a5c38;   /* pass/success states */
  --green-bg:   #e8f4ee;
  --red:        #7a1c1c;   /* reject/error states */
  --red-bg:     #faeaea;
}
```

### Typography Rules

| Typeface | Weight | Used for |
|----------|--------|----------|
| Playfair Display | 700–800 | h1, h2, large stat numbers (`.guarantee-num`, `.tier-stat`) |
| Source Serif 4 | 400 body, 600 bold | Body copy, h3, table content |
| DM Mono | 400–500 | `.section-subtitle`, step numbers, badges, `<code>`, `.meta`, `.doc-footer` |

Source Serif 4 renders notably well at 15–15.5px. Do not use it smaller than 13px.

### Layout

```css
html, body { background: #fff; }  /* no gray margins — critical for ultrawide */

body {
  font-family: 'Source Serif 4', Georgia, serif;
  font-size: 15.5px;        /* 15px for denser reference docs */
  line-height: 1.7;
  color: var(--ink);
  max-width: 1500px;        /* ultrawide-friendly */
  margin: 0 auto;
  padding: 56px 82px 88px;  /* validated: 82px side for large monitors */
}
```

**Important:** `max-width: 1500px` with `html/body { background: #fff }` means margins on ultrawide are white-on-white — invisible. Do not add a background to `html` or `body` unless you intend visible margins.

### Section Heading Pattern

Every section follows the same pattern: large serif heading + small DM Mono subtitle below it.

```html
<section>
  <h2>Section Name</h2>
  <p class="section-subtitle">Descriptor — what this section covers</p>
  <!-- content -->
</section>
```

```css
h2 {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 1.7rem;
  font-weight: 700;
  border-bottom: 1.5px solid var(--ink);
  padding-bottom: 10px;
  margin-bottom: 5px;        /* tight — subtitle sits close to heading */
}
.section-subtitle {
  font-family: 'DM Mono', monospace;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--ink-faint);
  letter-spacing: 1.8px;
  text-transform: uppercase;
  margin-bottom: 20px;
}
```

### Tables

All tables share this base. The header line is 1.5px solid ink. Table rows use `--rule` (lighter). Last row has no border.

```css
table { width: 100%; border-collapse: collapse; margin: 16px 0; }
th {
  font-family: 'DM Mono', monospace;
  font-size: 0.68rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--ink-faint);
  padding: 0 16px 9px 0;
  border-bottom: 1.5px solid var(--ink);
  text-align: left;
}
td {
  font-size: 0.88rem;
  padding: 12px 20px 12px 0;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
  color: var(--ink-mid);
  line-height: 1.65;
}
tr:last-child td { border-bottom: none; }
td strong { color: var(--ink); font-weight: 600; }
```

For tables where the first column needs distinct styling (e.g., phase names, numbered steps), add a class to the table and style `table.classname td:first-child` separately. Do not wrap column content in `<strong>` as a substitute for this — use the class.

### Print Media Query

Always include this. It resets layout for PDF export cleanly.

```css
@media print {
  html, body { background: #fff; }
  body {
    max-width: none;
    margin: 0;
    padding: 0.75in 0.9in 0.9in;
    font-size: 11pt;
  }
  .diagram-wrap { break-inside: avoid; }
  section { break-inside: avoid; }
}
```

---

## Component Library

### Mermaid Diagram Wrapper

```html
<div class="diagram-wrap">
  <div class="mermaid">
    flowchart TD
      A["<b>Bold label</b>
    second line text"] --> B
  </div>
</div>
```

```css
.diagram-wrap {
  margin: 20px 0;
  padding: 20px;
  background: var(--paper);
  border: 1px solid var(--rule);
  overflow-x: auto;
  text-align: center;
}
```

Mermaid notes:
- `<b>` tags work inside node labels for bold text
- Use `&amp;` for `&` inside node labels
- Edge labels: `-->|"label text"|`
- Round terminal nodes: `([text])`
- For flowcharts with reject paths, always show all exit points explicitly

### Callout Blocks (Type A)

Two variants: accent (informational) and warning (tension/problem).

```html
<div class="callout">
  <p><strong>Title.</strong> Body text.</p>
</div>

<div class="callout-warning">
  <p><strong>Title.</strong> Body text.</p>
</div>
```

```css
.callout {
  background: var(--accent-bg);
  border-left: 2px solid var(--accent);
  padding: 14px 18px;
  margin: 18px 0;
}
.callout-warning {
  background: var(--warn-bg);
  border-left: 2px solid var(--warn);
  padding: 14px 18px;
  margin: 18px 0;
}
.callout p, .callout-warning p { margin-bottom: 8px; color: var(--ink); }
.callout p:last-child, .callout-warning p:last-child { margin-bottom: 0; }
```

### Guarantee List (Type A — numbered items with display numbers)

Use for 3–6 key properties or guarantees. The large Playfair numbers create editorial weight.

```html
<ul class="guarantee-list">
  <li>
    <span class="guarantee-num">01</span>
    <div class="guarantee-content">
      <strong>Property name</strong>
      <span>Explanatory text.</span>
    </div>
  </li>
</ul>
```

```css
.guarantee-list { list-style: none; margin: 20px 0; border-top: 1px solid var(--rule); }
.guarantee-list li {
  display: grid;
  grid-template-columns: 72px 1fr;
  padding: 18px 0;
  border-bottom: 1px solid var(--rule);
}
.guarantee-num {
  font-family: 'Playfair Display', serif;
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--accent);
  line-height: 1;
  padding-top: 4px;
}
.guarantee-content strong {
  display: block;
  font-family: 'Source Serif 4', serif;
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--ink);
  margin-bottom: 4px;
}
.guarantee-content span { font-size: 0.88rem; color: var(--ink-light); line-height: 1.6; }
```

### Stat Display (Type A — large metric with caption)

Use inside `.tier-body` or standalone. The large Playfair number immediately communicates scale.

```html
<div class="tier-stat">89.7%</div>
<p>rule match rate against Oregon Medicaid data.</p>
```

```css
.tier-stat {
  font-family: 'Playfair Display', serif;
  font-size: 2rem;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -1px;
  margin-bottom: 4px;
  line-height: 1;
}
```

Always use `<p>` tags for text below a stat — never `<br><br>`.

### Validation / Content Tiers (Type A — 2-column comparison panels)

Use for side-by-side comparisons (two validation approaches, pilot data you provide vs what we run, etc.).

```html
<div class="validation-tiers">
  <div class="tier">
    <div class="tier-header public">External — Public data</div>
    <div class="tier-body">
      <div class="tier-stat">89.7%</div>
      <p>Description of what this number means.</p>
      <p><strong>What this shows:</strong> ...</p>
    </div>
  </div>
  <div class="tier">
    <div class="tier-header internal">Internal — Golden test suite</div>
    <div class="tier-body">
      <div class="tier-stat">30 cases</div>
      <p>Description.</p>
    </div>
  </div>
</div>
```

```css
.validation-tiers { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
.tier { border: 1px solid var(--rule); overflow: hidden; }
.tier-header { padding: 9px 14px; font-family: 'DM Mono', monospace; font-size: 0.68rem; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; }
.tier-header.public   { background: #f0ece4; color: var(--ink-light); }
.tier-header.internal { background: #e8edf8; color: var(--accent); }
.tier-body { padding: 14px; font-size: 0.88rem; color: var(--ink-mid); line-height: 1.6; }
```

### Decision Trace Block (Type A)

For displaying code or structured trace output. Left accent border signals it's a primary artifact, not incidental code.

```html
<pre class="trace-block">step 1. eligibility_check → pass
step 2. ndc_normalization → 00093-1234-56</pre>
```

```css
.trace-block {
  font-family: 'DM Mono', monospace;
  font-size: 0.78rem;
  line-height: 1.8;
  color: var(--ink-mid);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-left: 2px solid var(--accent);
  padding: 20px 24px;
  margin: 20px 0;
  overflow-x: auto;
  white-space: pre;
}
```

### Trace Annotations Grid (Type A)

Three annotation cards below a trace block. Calls out specific steps worth explaining.

```html
<div class="trace-annotations">
  <div class="trace-ann">
    <div class="trace-ann-label">Steps 9–13 · Heading</div>
    <p>Explanation.</p>
  </div>
  <!-- repeat × 3 -->
</div>
```

```css
.trace-annotations { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin: 16px 0 24px; }
.trace-ann { border: 1px solid var(--rule); padding: 12px 14px; }
.trace-ann-label { font-family: 'DM Mono', monospace; font-size: 0.68rem; font-weight: 500; color: var(--accent); letter-spacing: 0.5px; margin-bottom: 6px; }
.trace-ann p { font-size: 0.82rem; color: var(--ink-light); line-height: 1.5; margin: 0; }
```

### Step Number Column (Type B)

For pipeline or process tables with numbered steps. DM Mono in accent color, smaller than body.

```html
<td><span class="step-n">01</span></td>
<td><strong>step_name</strong></td>
<td>Description of what it reads and decides.</td>
```

```css
.step-n {
  font-family: 'DM Mono', monospace;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent);
}
```

### Phase Name Column (Type B)

For tables where the first column is a phase/stage name with a separate number component.

```html
<table class="phases-table">
  <tr>
    <td><span class="phase-n">1</span> Identity &amp; Coverage</td>
    <td>What this phase does.</td>
  </tr>
</table>
```

```css
.phases-table td:first-child {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
}
.phases-table td:first-child .phase-n {
  font-family: 'DM Mono', monospace;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent);
  margin-right: 2px;
}
```

### Badge System (Type B)

For category and severity labels in tables. Use consistently — pick a set for a given document and stick to it.

```html
<span class="badge badge-safety">Safety</span>
<span class="badge badge-util">Utilization</span>
<span class="badge badge-clinical">Clinical</span>
<span class="badge badge-hard">Hard</span>
<span class="badge badge-soft">Soft</span>
<span class="badge badge-pass">Pass</span>
```

```css
.badge {
  display: inline-block;
  font-family: 'DM Mono', monospace;
  font-size: 0.65rem;
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 2px;
}
.badge-safety   { background: var(--red-bg);   color: var(--red); }
.badge-util     { background: var(--warn-bg);  color: var(--warn); }
.badge-clinical { background: var(--accent-bg); color: var(--accent); }
.badge-hard     { background: var(--red-bg);   color: var(--red); }
.badge-soft     { background: var(--warn-bg);  color: var(--warn); }
.badge-pass     { background: var(--green-bg); color: var(--green); }
```

### Rule Block (Type B)

For surfacing invariants, constraints, and non-obvious rules that don't belong in prose. Lighter than a callout — doesn't interrupt reading, but clearly demarcated.

```html
<div class="rule-block">
  <strong>Rule name:</strong> Explanation of the constraint or invariant.
  Code references: <code>field_name</code>.
</div>
```

```css
.rule-block {
  background: var(--paper);
  border-left: 2px solid var(--accent);
  padding: 12px 16px;
  margin: 14px 0;
  font-size: 0.87rem;
  color: var(--ink-mid);
  line-height: 1.65;
}
.rule-block strong { color: var(--ink); }
.rule-block code { font-family: 'DM Mono', monospace; font-size: 0.82em; }
```

### Two-Column Reference Grid (Type B)

For side-by-side reference panels — related concepts, before/after, two approaches.

```html
<div class="ref-grid">
  <div class="ref-panel">
    <div class="ref-panel-label">Panel A</div>
    <ul>
      <li>Item one</li>
      <li>Item two</li>
    </ul>
  </div>
  <div class="ref-panel">
    <div class="ref-panel-label">Panel B</div>
    <p>Prose description.</p>
  </div>
</div>
```

```css
.ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 16px 0; }
.ref-panel { border: 1px solid var(--rule); padding: 14px 16px; }
.ref-panel-label { font-family: 'DM Mono', monospace; font-size: 0.68rem; font-weight: 500; color: var(--accent); letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 8px; }
.ref-panel p { font-size: 0.86rem; color: var(--ink-light); line-height: 1.55; margin: 0; }
.ref-panel ul { list-style: none; margin: 0; padding: 0; }
.ref-panel li { font-size: 0.85rem; color: var(--ink-mid); padding: 3px 0; border-bottom: 1px solid #f0ece4; line-height: 1.45; }
.ref-panel li:last-child { border-bottom: none; }
```

### Phase Strip (Type B)

Horizontal 4-cell band for showing phases or stages with different states. Particularly useful for state machines (Part D phases, pipeline stages, lifecycle states).

```html
<div class="phase-strip">
  <div class="phase-cell">
    <div class="phase-cell-label">Phase 1</div>
    <div class="phase-cell-name">Name</div>
    <div class="phase-cell-desc">Description of what happens in this phase.</div>
  </div>
  <div class="phase-cell active">...</div>
  <div class="phase-cell gap">...</div>
  <div class="phase-cell catas">...</div>
</div>
```

```css
.phase-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 16px 0; border: 1px solid var(--rule); }
.phase-cell { padding: 12px 14px; border-right: 1px solid var(--rule); }
.phase-cell:last-child { border-right: none; }
.phase-cell-label { font-family: 'DM Mono', monospace; font-size: 0.65rem; font-weight: 500; color: var(--ink-faint); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
.phase-cell-name { font-family: 'Source Serif 4', serif; font-weight: 600; font-size: 0.88rem; color: var(--ink); margin-bottom: 6px; }
.phase-cell-desc { font-size: 0.82rem; color: var(--ink-light); line-height: 1.5; }
.phase-cell.active { background: #edf1f8; }
.phase-cell.gap    { background: #fdf6ed; }
.phase-cell.catas  { background: #e8f4ee; }
```

### Document Header and Footer

```html
<div class="doc-header">
  <h1>Document Title</h1>
  <p class="subtitle">One sentence describing what this is and who it's for.</p>
  <p class="meta">Context · Date</p>
</div>

<!-- ... sections ... -->

<div class="doc-footer">
  Project · Document type · Date · Audience note
</div>
```

```css
.doc-header { border-bottom: 3px solid var(--ink); padding-bottom: 28px; margin-bottom: 56px; }
.doc-header h1 { font-family: 'Playfair Display', serif; font-size: 2.5rem; font-weight: 800; letter-spacing: -1px; line-height: 1.1; margin-bottom: 12px; }
.doc-header .subtitle { font-family: 'Source Serif 4', serif; font-style: italic; font-size: 1rem; color: var(--ink-light); line-height: 1.55; }
.doc-header .meta { margin-top: 20px; font-family: 'DM Mono', monospace; font-size: 0.7rem; color: var(--ink-faint); letter-spacing: 1.5px; text-transform: uppercase; }
.doc-footer { margin-top: 64px; padding-top: 20px; border-top: 1px solid var(--rule); font-family: 'DM Mono', monospace; font-size: 0.68rem; color: var(--ink-faint); text-align: center; letter-spacing: 1px; text-transform: uppercase; }
```

---

## Process

### Before writing

1. **Identify document type** (A = pitch, B = reference). If unclear, ask.
2. **Identify the audience** — determines how much domain context to establish before getting to the content.
3. **Outline the sections** before writing HTML. Get alignment on the structure.
4. **Read any source specs or docs** that the HTML will draw from. Don't invent content — the document summarizes real systems.

### Writing

- Write all CSS at once in `<style>` inside `<head>` — do not inline styles
- Use `<section>` tags for major sections — keeps print pagination clean
- Always use `<p>` tags for paragraph spacing. Never `<br><br>`
- Use HTML entities: `&amp;` for &, `&middot;` for ·, `&mdash;` for —
- For `<code>` inline: `font-family: 'DM Mono'; font-size: 0.85em; background: var(--paper); padding: 1px 5px; border: 1px solid var(--rule)`

### Layout iteration notes

The padding has been calibrated for a large primary monitor. These are the validated values — do not change without user feedback:
- Side padding: `82px`
- Top: `56px`
- Bottom: `88px`
- max-width: `1500px`

If padding feels too tight or too loose on a specific display, adjust side padding in 20–30px increments — 10px changes are not perceptible.

### Common mistakes to avoid

- `<br><br>` for spacing — always use `<p>` with appropriate `margin-bottom`
- Missing `class="phases-table"` on tables with styled first columns — the CSS won't apply
- Forgetting `html, body { background: #fff }` — produces visible gray margins on ultrawide
- Hardcoding colors outside the variable system — breaks color coherence
- Using `<strong>` as a substitute for a column class — creates inconsistent sizing
- Mermaid: forgetting `&amp;` in node labels with `&` — breaks diagram rendering
- Missing print media query — document won't export to PDF cleanly

---

## Examples

| Document | Type | File | Notable patterns used |
|----------|------|------|----------------------|
| RxReverse Overview | A (Pitch) | `RxReverse/docs/rxreverse-overview.html` | guarantee-list, tier-stat, trace-block + annotations, replay guarantee diagram, callout-warning |
| Adjudication Logic Reference | B (Reference) | `RxReverse/docs/adjudication-logic-reference.html` | step-n column, phase-n table, badge system, rule-block, ref-grid, phase-strip, 22-step trace table |
