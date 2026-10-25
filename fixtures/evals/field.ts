import type { VariantInput } from "../../src/types.js";

/**
 * A fixed field of compliant, distinct Budgetly variants. Evals use these so
 * runs are comparable and skip the generator's cost. Quality is deliberately
 * mixed: some solid, some flat.
 */
export const FIELD: VariantInput[] = [
  {
    angle: "fear of missing out",
    hook: "Everyone's doing a December money check. You're doing vibes.",
    primaryText: "Budgetly sorts your spending into categories automatically, so you can see where December went before January asks. Two minutes a week.",
    headline: "See it before it's gone",
    cta: "Get Budgetly",
    visualPrompt: "Phone screen recording: festive spending sorting itself into categories, tangerine accent, off-white background, real hand scrolling.",
  },
  {
    angle: "social proof",
    hook: "My friends stopped asking 'where did my money go' in group chat.",
    primaryText: "Turns out they all got the same app. Budgetly connects to your bank and gives you one weekly check-in with one useful suggestion.",
    headline: "The group chat switched",
    cta: "Install free",
    visualPrompt: "Screenshot-style group chat on a phone, messages about weekly check-ins, Budgetly notification sliding in. Natural lighting.",
  },
  {
    angle: "humour",
    hook: "POV: your bank app just shows you a number and wishes you luck.",
    primaryText: "Budgetly shows you why that number looks like that. Auto categories, bill reminders, zero judgement about the third bubble tea.",
    headline: "Context for your balance",
    cta: "Try Budgetly",
    visualPrompt: "Split screen: a stark bank balance on the left, Budgetly's colourful category breakdown on the right, bubble tea on the desk.",
  },
  {
    angle: "relief and calm",
    hook: "January you will thank December you for this.",
    primaryText: "Set a savings goal for the holidays and Budgetly keeps an eye on it for you. Weekly check-ins, no spreadsheets, no lectures.",
    headline: "A calmer January",
    cta: "Start for free",
    visualPrompt: "Soft morning light, someone on a couch checking a savings goal progress ring on their phone, ink-blue and tangerine palette.",
  },
  {
    angle: "identity and adulting",
    hook: "Adulting tip nobody gave you: know your numbers.",
    primaryText: "Your first real pay cheque deserves better than guesswork. Budgetly does the sorting, you make the calls.",
    headline: "Adulting, simplified",
    cta: "Get the app",
    visualPrompt: "Young person opening a first payslip email, then the Budgetly dashboard. Real apartment, no stock-photo smiles.",
  },
  {
    angle: "curiosity",
    hook: "I found R1,840 I didn't know I was spending.",
    primaryText: "Subscriptions add up quietly. Budgetly flags the recurring ones so you can decide what stays.",
    headline: "Find the quiet spenders",
    cta: "See yours",
    visualPrompt: "Close-up of a phone list of recurring subscriptions being highlighted one by one, plausible amounts in rand.",
  },
  {
    angle: "feature demo",
    hook: "Here's the whole app in 9 seconds.",
    primaryText: "Connect your bank. Spending sorts itself. Every Sunday you get one check-in and one suggestion. That's it.",
    headline: "Budgeting in two minutes a week",
    cta: "Download",
    visualPrompt: "Fast screen capture walkthrough: connect bank, categories animate in, Sunday check-in card. Clean UI, off-white background.",
  },
  {
    angle: "challenge",
    hook: "Try the 7-day no-surprises challenge.",
    primaryText: "For one week, check Budgetly before you tap to pay. Most people find one habit they want to change. Free to start.",
    headline: "7 days, no surprises",
    cta: "Take the challenge",
    visualPrompt: "Day-by-day calendar overlay on a phone, each day checked off, short captions, tangerine checkmarks.",
  },
];
