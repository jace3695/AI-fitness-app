-- Jace AI Hub tables contain private, per-user data. RLS is the primary row
-- boundary, while these grants keep the Data API surface to the operations the
-- application actually uses.

revoke all privileges on table
  public.user_app_state,
  public.language_user_state,
  public.push_subscriptions,
  public.shared_profiles,
  public.assistant_projects,
  public.assistant_items,
  public.assistant_memories,
  public.assistant_preferences,
  public.budget_profiles,
  public.budget_transactions,
  public.budget_savings,
  public.budget_income,
  public.budget_user_settings,
  public.budget_monthly_budgets,
  public.budget_category_budgets,
  public.budget_recurring_expense_preferences
from anon;

revoke truncate, references, trigger on table
  public.user_app_state,
  public.language_user_state,
  public.push_subscriptions,
  public.shared_profiles,
  public.assistant_projects,
  public.assistant_items,
  public.assistant_memories,
  public.assistant_preferences,
  public.budget_profiles,
  public.budget_transactions,
  public.budget_savings,
  public.budget_income,
  public.budget_user_settings,
  public.budget_monthly_budgets,
  public.budget_category_budgets,
  public.budget_recurring_expense_preferences
from authenticated;

grant select, insert, update, delete on table
  public.user_app_state,
  public.language_user_state,
  public.push_subscriptions,
  public.shared_profiles,
  public.assistant_projects,
  public.assistant_items,
  public.assistant_memories,
  public.assistant_preferences,
  public.budget_profiles,
  public.budget_transactions,
  public.budget_savings,
  public.budget_income,
  public.budget_user_settings,
  public.budget_monthly_budgets,
  public.budget_category_budgets,
  public.budget_recurring_expense_preferences
to authenticated;
