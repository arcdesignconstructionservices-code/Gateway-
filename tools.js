/* ============================================================
   ARC+ GATEWAY — the list of tools shown on the dashboard.
   To add a tool: copy one block below, change the values, push.
     id      unique short name (used for favourites)
     name    card title
     desc    one or two lines under the title
     group   the department chip on the card
     url     where "Open App" goes (leave '' while it is not ready)
     icon    one of: payroll, inventory, doc, tool
   ============================================================ */
const GATEWAY_TOOLS = [
  {
    id: 'payroll',
    name: 'ARC+ Payroll',
    desc: 'Weekly payroll, employees, cash advances, payslips and payroll history with Excel export.',
    group: 'Payroll',
    url: 'https://payroll.arcdesignconstructions.com',
    icon: 'payroll'
  },
  {
    id: 'inventory',
    name: 'ARC+ Inventory Tool',
    desc: 'Tools and materials: QR labels and scanning, check-out / check-in, stock changes, alerts and history.',
    group: 'Operations',
    url: 'https://inventory.arcdesignconstructions.com',
    icon: 'inventory'
  }
];
