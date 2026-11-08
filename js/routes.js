// URL builders for every screen, so views never hard-code hash paths.
//
// The four tabs:
//   #/accounts                      Accounts & Budgets
//   #/daily/<month>                 Daily expenses
//   #/plan/<month>                  Planned → Bills (monthly bills, subscriptions, salary)
//   #/plan/<month>/buy[/<cat>[/<sub>]]   Planned → To Buy → category (its budget and items) → subcategory
//   #/summary/<month>               Summary of the month
// Other screens:
//   #/accounts/a/<accountId>        one account's transactions
//   #/todo/<month>[/<list>]         To Do lists
//   #/reports[/<report>[/<month>]]  detailed reports
//   #/settings
const enc = encodeURIComponent;

export const routes = {
  accounts: () => '#/accounts',
  account: (id) => `#/accounts/a/${enc(id)}`,
  daily: (month) => `#/daily/${month}`,
  bills: (month) => `#/plan/${month}`,
  budgets: (month, cat = null, sub = null) => `#/plan/${month}/buy${cat ? `/${enc(cat)}` : ''}${sub ? `/${enc(sub)}` : ''}`,
  summary: (month) => `#/summary/${month}`,
  todo: (month, list = null) => `#/todo/${month}${list ? `/${enc(list)}` : ''}`,
  reports: () => '#/reports',
  report: (key, month = null) => `#/reports/${key}${month ? `/${month}` : ''}`,
  settings: () => '#/settings',
};
