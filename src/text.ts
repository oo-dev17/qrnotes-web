export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escaped zuerst, dann nur http(s)-Links ersetzen. So kann Notiztext kein HTML einschleusen.
export function linkifyText(text: string): string {
  return escapeHtml(text).replace(/https?:\/\/[^\s<>]+/g, (raw) => {
    // Satzzeichen direkt hinter der URL gehört nicht zum Link.
    const trail = raw.match(/(?:&quot;|&#39;|&lt;|&gt;|[.,;:!?)\]])+$/);
    const url = trail ? raw.slice(0, raw.length - trail[0].length) : raw;
    const rest = trail ? trail[0] : '';
    return (
      `<a href="${url}" target="_blank" rel="noopener noreferrer" ` +
      `class="text-violet-400 underline break-all">${url}</a>${rest}`
    );
  });
}
