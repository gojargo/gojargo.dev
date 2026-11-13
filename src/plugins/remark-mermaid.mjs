// Turns ```mermaid fences into <pre class="mermaid"> before Expressive Code
// sees them; src/components/starlight/MarkdownContent.astro renders them in the
// browser (mermaid is loaded only on pages that have a diagram).
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function remarkMermaid() {
  const walk = (node) => {
    if (!node.children) return;
    node.children = node.children.map((child) => {
      if (child.type === 'code' && child.lang === 'mermaid') {
        return { type: 'html', value: `<pre class="mermaid not-content">${escape(child.value)}</pre>` };
      }
      walk(child);
      return child;
    });
  };
  return walk;
}
