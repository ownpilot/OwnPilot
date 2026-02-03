import { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Filter,
  RefreshCw,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { expensesApi } from '../api';
import type {
  ExpenseEntry,
  ExpenseMonthlyResponse as MonthlyResponse,
  ExpenseSummaryResponse as SummaryResponse,
} from '../api';
import { useToast } from '../components/ToastProvider';


const CATEGORY_LABELS: Record<string, string> = {
  food: 'Food',
  transport: 'Transport',
  utilities: 'Utilities',
  entertainment: 'Entertainment',
  shopping: 'Shopping',
  health: 'Health',
  education: 'Education',
  travel: 'Travel',
  subscription: 'Subscription',
  housing: 'Housing',
  other: 'Other',
};

export function ExpensesPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [monthlyData, setMonthlyData] = useState<MonthlyResponse | null>(null);
  const [summaryData, setSummaryData] = useState<SummaryResponse | null>(null);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New expense form state
  const [newExpense, setNewExpense] = useState({
    date: new Date().toISOString().split('T')[0],
    amount: '',
    currency: 'TRY',
    category: 'other',
    description: '',
    notes: '',
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch monthly data
      const monthlyJson = await expensesApi.monthly(year);
      setMonthlyData(monthlyJson);

      // Fetch summary for current period
      const summaryParams: Record<string, string> = selectedMonth
        ? { startDate: `${year}-${selectedMonth}-01`, endDate: `${year}-${selectedMonth}-31` }
        : { period: 'this_year' };
      const summaryJson = await expensesApi.summary(summaryParams);
      setSummaryData(summaryJson);

      // Fetch expense list
      const listParams: Record<string, string> = selectedMonth
        ? { startDate: `${year}-${selectedMonth}-01`, endDate: `${year}-${selectedMonth}-31`, limit: '50' }
        : { startDate: `${year}-01-01`, endDate: `${year}-12-31`, limit: '50' };
      const listJson = await expensesApi.list(listParams);
      setExpenses((listJson as Record<string, unknown>).expenses as ExpenseEntry[]);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [year, selectedMonth]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await expensesApi.create({
        ...newExpense,
        amount: parseFloat(newExpense.amount),
      });
      toast.success('Expense added');
      setShowAddForm(false);
      setNewExpense({
        date: new Date().toISOString().split('T')[0],
        amount: '',
        currency: 'TRY',
        category: 'other',
        description: '',
        notes: '',
      });
      fetchData();
    } catch {
      // API client handles error reporting
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this expense?', variant: 'danger' })) return;
    try {
      await expensesApi.delete(id);
      toast.success('Expense deleted');
      fetchData();
    } catch {
      // API client handles error reporting
    }
  };

  const maxMonthTotal = monthlyData
    ? Math.max(...monthlyData.months.map((m) => m.total), 1)
    : 1;

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-bg-primary dark:bg-dark-bg-primary border-b border-border dark:border-dark-border">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              Expenses
            </h1>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Monthly expense tracking and analysis
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Expense
            </button>
            <button
              onClick={fetchData}
              className="p-2 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Year Selector */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setYear((y) => y - 1)}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-xl font-semibold text-text-primary dark:text-dark-text-primary">
            {year}
          </span>
          <button
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= new Date().getFullYear()}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors disabled:opacity-50"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          {selectedMonth && (
            <button
              onClick={() => setSelectedMonth(null)}
              className="ml-4 px-3 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
            >
              Show Full Year
            </button>
          )}
        </div>

        {/* Summary Cards */}
        {summaryData && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-4 border border-border dark:border-dark-border">
              <div className="flex items-center gap-2 text-text-muted dark:text-dark-text-muted mb-1">
                <DollarSign className="w-4 h-4" />
                <span className="text-sm">Total by Currency</span>
              </div>
              <div className="space-y-1">
                {Object.entries(summaryData.summary.totalByCurrency).map(([currency, amount]) => (
                  <div key={currency} className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
                    {(amount as number).toLocaleString('en-US')} {currency}
                  </div>
                ))}
                {Object.keys(summaryData.summary.totalByCurrency).length === 0 && (
                  <div className="text-lg font-bold text-text-primary dark:text-dark-text-primary">0</div>
                )}
              </div>
            </div>
            <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-4 border border-border dark:border-dark-border">
              <div className="flex items-center gap-2 text-text-muted dark:text-dark-text-muted mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm">Daily Average</span>
              </div>
              <div className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                {summaryData.summary.dailyAverage.toLocaleString('en-US')}
              </div>
            </div>
            <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-4 border border-border dark:border-dark-border">
              <div className="flex items-center gap-2 text-text-muted dark:text-dark-text-muted mb-1">
                <Calendar className="w-4 h-4" />
                <span className="text-sm">Transactions</span>
              </div>
              <div className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
                {summaryData.summary.totalExpenses}
              </div>
            </div>
            <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-4 border border-border dark:border-dark-border">
              <div className="flex items-center gap-2 text-text-muted dark:text-dark-text-muted mb-1">
                <Filter className="w-4 h-4" />
                <span className="text-sm">Top Category</span>
              </div>
              <div className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
                {summaryData.summary.topCategories[0]
                  ? CATEGORY_LABELS[summaryData.summary.topCategories[0].category] ||
                    summaryData.summary.topCategories[0].category
                  : '-'}
              </div>
            </div>
          </div>
        )}

        {/* Monthly Chart */}
        {monthlyData && (
          <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-6 border border-border dark:border-dark-border">
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">
              Monthly Expenses
            </h2>
            <div className="flex items-end gap-2 h-48">
              {monthlyData.months.map((month) => (
                <button
                  key={month.monthNum}
                  onClick={() =>
                    setSelectedMonth(
                      selectedMonth === month.monthNum ? null : month.monthNum
                    )
                  }
                  className={`flex-1 flex flex-col items-center gap-1 group ${
                    selectedMonth === month.monthNum ? 'opacity-100' : 'opacity-80 hover:opacity-100'
                  }`}
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      selectedMonth === month.monthNum
                        ? 'bg-primary'
                        : 'bg-primary/60 group-hover:bg-primary/80'
                    }`}
                    style={{
                      height: `${(month.total / maxMonthTotal) * 100}%`,
                      minHeight: month.total > 0 ? '4px' : '0',
                    }}
                    title={`${month.total.toLocaleString('en-US')}`}
                  />
                  <span className="text-xs text-text-muted dark:text-dark-text-muted">
                    {month.month.slice(0, 3)}
                  </span>
                  {month.total > 0 && (
                    <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
                      {month.total >= 1000
                        ? `${(month.total / 1000).toFixed(1)}K`
                        : month.total.toFixed(0)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-4 text-center text-sm text-text-muted dark:text-dark-text-muted">
              Year Total: {monthlyData.yearTotal.toLocaleString('en-US')}
            </div>
          </div>
        )}

        {/* Category Breakdown */}
        {summaryData && summaryData.summary.topCategories.length > 0 && (
          <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl p-6 border border-border dark:border-dark-border">
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">
              By Category
            </h2>
            <div className="space-y-3">
              {summaryData.summary.topCategories.map((cat) => (
                <div key={cat.category} className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="flex-1 text-sm text-text-primary dark:text-dark-text-primary">
                    {CATEGORY_LABELS[cat.category] || cat.category}
                  </span>
                  <span className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                    {cat.amount.toLocaleString('en-US')}
                  </span>
                  <span className="text-xs text-text-muted dark:text-dark-text-muted w-12 text-right">
                    {cat.percentage}%
                  </span>
                  <div className="w-24 h-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${cat.percentage}%`,
                        backgroundColor: cat.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expense List */}
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
          <div className="px-6 py-4 border-b border-border dark:border-dark-border">
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Expense List
              {selectedMonth && (
                <span className="ml-2 text-sm font-normal text-text-muted dark:text-dark-text-muted">
                  ({monthlyData?.months.find((m) => m.monthNum === selectedMonth)?.month} {year})
                </span>
              )}
            </h2>
          </div>
          <div className="divide-y divide-border dark:divide-dark-border max-h-96 overflow-y-auto">
            {expenses.length === 0 ? (
              <div className="px-6 py-8 text-center text-text-muted dark:text-dark-text-muted">
                No expenses recorded for this period
              </div>
            ) : (
              expenses.map((expense) => (
                <div
                  key={expense.id}
                  className="px-6 py-3 flex items-center gap-4 hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50"
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor:
                        monthlyData?.categories[expense.category as keyof typeof monthlyData.categories]
                          ?.color ?? '#AEB6BF',
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                      {expense.description}
                    </div>
                    <div className="text-xs text-text-muted dark:text-dark-text-muted">
                      {new Date(expense.date).toLocaleDateString('en-US')} •{' '}
                      {CATEGORY_LABELS[expense.category] || expense.category}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                    {expense.amount.toLocaleString('en-US')} {expense.currency}
                  </div>
                  <button
                    onClick={() => handleDeleteExpense(expense.id)}
                    className="p-1.5 text-text-muted hover:text-error transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Add Expense Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-border dark:border-dark-border">
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Add New Expense
              </h3>
            </div>
            <form onSubmit={handleAddExpense} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={newExpense.date}
                    onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Amount
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      value={newExpense.amount}
                      onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                      placeholder="0.00"
                      className="flex-1 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary"
                      required
                    />
                    <select
                      value={newExpense.currency}
                      onChange={(e) => setNewExpense({ ...newExpense, currency: e.target.value })}
                      className="w-20 px-2 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary"
                    >
                      <option value="TRY">TRY</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Category
                </label>
                <select
                  value={newExpense.category}
                  onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary"
                >
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={newExpense.description}
                  onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                  placeholder="Store or expense description"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={newExpense.notes}
                  onChange={(e) => setNewExpense({ ...newExpense, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary resize-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 px-4 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary rounded-lg hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
