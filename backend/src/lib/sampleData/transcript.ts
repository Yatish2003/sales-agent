export const SAMPLE_TRANSCRIPT = `
Standup — Northlight internal ops, 12 Sep 2026

Ava Chen: Shipping the customer health dashboard this cycle. Decision: we freeze new Looker explores after Wednesday so Jordan can write the launch copy.

Jordan Patel: Agreed. I need the dashboard screenshots by Thursday or the launch email slips.

Samir Okonkwo: Pipeline for the health scores is still flaky — we decided last week to audit the dbt models before the freeze. I can own that, but I already have three other pipeline tickets.

Riley Nguyen: Design will mock the empty states. No deadline was set.

Morgan Ellis: Constraint: nobody takes a fourth concurrent task. Sprint ends Friday in two weeks.

Ava Chen: Also — legal said the health-score copy cannot mention "churn prediction" until they review. That's a hard constraint.

Jordan Patel: Wait, I thought we *were* allowed to say churn prediction in the in-app tooltip? That's what I wrote in the brief yesterday.

Samir Okonkwo: Those two statements conflict. Someone needs to resolve legal vs product copy.

Riley Nguyen: Requirement: empty states should reuse the same illustration set as billing.

Ava Chen: We will not invent extra owners. If something is unowned, flag it.

Morgan Ellis: Decision: next customer advisory call is the Friday after next sprint, and Samir presents the pipeline audit findings there.
`.trim();
