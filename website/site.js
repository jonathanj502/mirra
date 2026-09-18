// The preview contains illustrative content only; it never records or sends data.
const tabs = [...document.querySelectorAll('[role="tab"]')];
const tablist = document.querySelector('[role="tablist"]');
if (tablist) {
  const compact = window.matchMedia('(max-width: 900px)');
  const orientTabs = () => tablist.setAttribute('aria-orientation', compact.matches ? 'horizontal' : 'vertical');
  orientTabs();
  compact.addEventListener('change', orientTabs);
}
function selectTab(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectTab(tabs[next], true); }
  });
});
document.querySelectorAll('[data-demo-next]').forEach(button => {
  button.addEventListener('click', () => {
    const tab = document.getElementById(`tab-${button.dataset.demoNext}`);
    selectTab(tab);
    document.getElementById(tab.getAttribute('aria-controls')).focus();
  });
});
const menu = document.querySelector('.mobile-menu');
menu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { menu.open = false; }));
menu?.addEventListener('keydown', event => {
  if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); }
});
