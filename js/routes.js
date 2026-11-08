// URL builders for every screen, so views never hard-code hash paths.
//
//   #/accounts                      accounts overview
//   #/accounts/all                  all transactions
//   #/accounts/a/<accountId>        one account's register
//   #/budgets/<month>[/<cat>[/<sub>]]   budgets → category items (To Buy) → subcategory
//   #/scheduled/<month>[/calendar|/todo[/<list>]]   bills & income, calendar, To Do
//   #/reports[/<report>[/<month>]]  reports list → one report
//   #/settings
const enc = encodeURIComponent;

export const routes = {
  accounts: () => '#/accounts',
  allTransactions: () => '#/accounts/all',
  account: (id) => `#/accounts/a/${enc(id)}`,
  budgets: (month, cat = null, sub = null) => `#/budgets/${month}${cat ? `/${enc(cat)}` : ''}${sub ? `/${enc(sub)}` : ''}`,
  scheduled: (month, view = 'list') => `#/scheduled/${month}${view === 'list' ? '' : `/${view}`}`,
  todo: (month, list = null) => `#/scheduled/${month}/todo${list ? `/${enc(list)}` : ''}`,
  reports: () => '#/reports',
  report: (key, month = null) => `#/reports/${key}${month ? `/${month}` : ''}`,
  settings: () => '#/settings',
};
