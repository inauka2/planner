// URL builders for every screen, so views never hard-code hash paths.
//
// The five tabs:
//   #/accounts                      Accounts & Budgets
//   #/daily/<month>                 Daily expenses
//   #/plan/<month>                  Planned: everything to buy or pay this month, by category
//   #/plan/<month>/buy/<cat>[/<sub>]     a category (its budget and items) → subcategory
//   #/todo/<month>[/<list>]         To Do lists
//   #/summary/<month>               Summary of the month
// Other screens:
//   #/accounts/a/<accountId>        one account's transactions
//   #/reports[/<report>[/<month>]]  detailed reports
//   #/settings
const enc = encodeURIComponent;

export const routes = {
  accounts: () => '#/accounts',
  account: (id) => `#/accounts/a/${enc(id)}`,
  daily: (month) => `#/daily/${month}`,
  budgets: (month, cat = null, sub = null) => (cat ? `#/plan/${month}/buy/${enc(cat)}${sub ? `/${enc(sub)}` : ''}` : `#/plan/${month}`),
  summary: (month) => `#/summary/${month}`,
  todo: (month, list = null) => `#/todo/${month}${list ? `/${enc(list)}` : ''}`,
  reports: () => '#/reports',
  report: (key, month = null) => `#/reports/${key}${month ? `/${month}` : ''}`,
  settings: () => '#/settings',
};
