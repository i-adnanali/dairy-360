/** Build measured A4 pages so identity does not depend on browser header repetition.
 * The live report remains the source; all records/disclosures are expanded first.
 */
export function reportPrintPages(source: HTMLElement, identity: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'life-print-pages';
  root.setAttribute('aria-hidden', 'true');
  document.body.append(root);
  let content!: HTMLElement;
  const page = () => {
    const sheet = document.createElement('div');
    sheet.className = 'life-print-page';
    const header = document.createElement('div');
    header.className = 'life-print-header';
    header.textContent = identity;
    content = document.createElement('div');
    content.className = 'life-print-content';
    sheet.append(header, content);
    root.append(sheet);
  };
  page();
  const title = document.createElement('h2');
  title.textContent = 'Animal lifetime report';
  content.append(title);
  const fits = (node: HTMLElement) => {
    content.append(node);
    const fits = content.scrollHeight <= content.clientHeight;
    node.remove();
    return fits;
  };
  const clean = (original: HTMLElement): HTMLElement => {
    const clone = original.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    clone.querySelectorAll('.no-print, app-local-pagination').forEach(n => n.remove());
    clone.querySelectorAll('details').forEach(n => n.open = true);
    return clone;
  };
  // Split oversized text at whitespace, retaining every character and line break.
  const text = (node: HTMLElement) => {
    let remaining = node.textContent || '';
    while (remaining) {
      const fragment = node.cloneNode(false) as HTMLElement;
      fragment.textContent = remaining;
      if (fits(fragment)) { content.append(fragment); return; }
      let low = 0, high = remaining.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        fragment.textContent = remaining.slice(0, mid);
        if (fits(fragment)) low = mid; else high = mid - 1;
      }
      if (!low) { page(); continue; }
      const boundary = remaining.slice(0, low).search(/\s+\S*$/);
      const end = boundary > 0 ? boundary + 1 : low;
      fragment.textContent = remaining.slice(0, end);
      content.append(fragment);
      remaining = remaining.slice(end);
      if (remaining) page();
    }
  };
  const fitsEmpty = (node: HTMLElement) => {
    const measure = document.createElement('div');
    measure.className = 'life-print-content';
    root.append(measure);
    measure.append(node);
    const fits = measure.scrollHeight <= measure.clientHeight;
    node.remove(); measure.remove();
    return fits;
  };
  const add = (node: HTMLElement) => {
    if (fits(node)) { content.append(node); return; }
    if (fitsEmpty(node)) { page(); content.append(node); return; }
    // Records longer than a page may fragment; retain their complete contents.
    if (node.children.length) {
      for (const child of Array.from(node.children)) add(child as HTMLElement);
    } else text(node);
  };
  try {
    for (const section of Array.from(source.querySelectorAll('section'))) {
      const children = Array.from(clean(section).children) as HTMLElement[];
      // Keep heading + explanatory note + the first record together when possible.
      const intro = document.createElement('div');
      const firstRecord = children.findIndex(n => n.tagName === 'ARTICLE');
      const end = firstRecord >= 0 ? firstRecord + 1 : children.length;
      intro.append(...children.slice(0, end));
      if (fits(intro)) content.append(intro);
      else {
        if (content.childElementCount) page();
        if (fits(intro)) content.append(intro);
        else {
          // An oversized first record cannot fit whole. Keep its opening text
          // with the heading, then paginate its remaining paragraphs.
          const record = children[firstRecord];
          if (record && record.children.length) {
            const opening = document.createElement('div');
            opening.append(...children.slice(0, firstRecord), record.firstElementChild!);
            add(opening);
            add(record);
          } else add(intro);
        }
      }
      for (const child of children.slice(end)) add(child);
    }
    return root;
  } catch (error) {
    root.remove();
    throw error;
  }
}
