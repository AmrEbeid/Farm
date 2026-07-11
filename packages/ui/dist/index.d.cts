import * as React from 'react';
export { BarChart, BarChartProps, ChartSeries, ChartTokens, DoughnutChart, DoughnutChartProps, DoughnutDatum, LineChart, LineChartProps, useChartTokens } from './charts.cjs';

type ButtonVariant = "primary" | "ghost" | "danger";
type ButtonSize = "md" | "sm";
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Visual style. `primary` = main action, `ghost` = secondary, `danger` = destructive/reject. */
    variant?: ButtonVariant;
    /** Control size. */
    size?: ButtonSize;
    /** Shows a spinner and disables interaction; the label is kept. */
    loading?: boolean;
    /** Optional leading icon (emoji or node). */
    icon?: React.ReactNode;
}
/**
 * Primary interactive control. Use one `primary` button per view.
 * A `disabled` button is also how the UI expresses a permission the role lacks
 * (e.g. a non-owner sees Approve disabled).
 */
declare const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;

type TagTone = "ok" | "warning" | "danger" | "info" | "neutral" | "accent";
interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Semantic status. Color reinforces meaning — the text must carry it too. */
    tone?: TagTone;
}
/**
 * Compact status label. Tones are semantic only (never decorative):
 * ok / warning / danger / info / neutral / accent.
 */
declare function Tag({ tone, children, className, ...rest }: TagProps): React.JSX.Element;

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Optional title rendered in the card header. */
    title?: React.ReactNode;
    /** Optional muted sub-line under the title. */
    subtitle?: React.ReactNode;
}
/** Content container — surface, large radius, medium elevation. */
declare function Card({ title, subtitle, children, className, ...rest }: CardProps): React.JSX.Element;

interface KpiCardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Metric label. */
    label: React.ReactNode;
    /** The main value (use the `unit` slot for the suffix). */
    value: React.ReactNode;
    /** Small unit/suffix shown after the value (e.g. "م ج.م"). */
    unit?: React.ReactNode;
    /** Optional leading icon (emoji or node). */
    icon?: React.ReactNode;
    /** Optional delta line under the value. */
    delta?: React.ReactNode;
    /**
     * Delta VALENCE (not a literal trend): `"down"` = attention/concern (red + a ⚠ mark), `"up"` =
     * positive/active (green + a ✓ mark), `"none"` = neutral. The mark is the non-colour cue required by
     * WCAG 1.4.1 (use of colour) so the state is distinguishable without seeing red/green; it's
     * aria-hidden because the delta TEXT already carries the meaning for assistive tech. Named
     * `deltaDirection` for back-compat, but consumers already use it as valence (down=problem, up=ok).
     */
    deltaDirection?: "up" | "down" | "none";
}
/** Dashboard metric tile: label + icon, large tabular value, optional delta. */
declare function KpiCard({ label, value, unit, icon, delta, deltaDirection, className, ...rest }: KpiCardProps): React.JSX.Element;

type AlertTone = "ok" | "info" | "warning" | "danger";
interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Severity. `danger` announces assertively to screen readers. */
    tone?: AlertTone;
    /** Bold title line. */
    title: React.ReactNode;
    /** Optional muted description. */
    description?: React.ReactNode;
    /** Optional leading icon (emoji or node). */
    icon?: React.ReactNode;
}
/** Inline message / alert used in dashboards and the notifications drawer. */
declare function Alert({ tone, title, description, icon, className, ...rest }: AlertProps): React.JSX.Element;

type ProgressTone = "default" | "warning" | "danger";
interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
    /** 0–100. Clamped. */
    value: number;
    /** Color tone — pair with a number/label nearby. */
    tone?: ProgressTone;
    /** Accessible label for the bar. */
    label?: string;
}
/** Linear progress bar for budget / plan completion. */
declare function Progress({ value, tone, label, className, ...rest }: ProgressProps): React.JSX.Element;

interface FieldProps {
    /** Field label (associated via htmlFor). */
    label: React.ReactNode;
    /** Stable id linking label → control. */
    id: string;
    /** Error message; sets aria-invalid and shows red text. */
    error?: string;
    /** Marks the field required: renders a decorative (aria-hidden) marker on the label and injects
     *  the native `required` attribute onto the control — so consumers stop hand-typing "*" into the
     *  label string (which some screen readers announce as "star"). */
    required?: boolean;
    /** The control. Defaults to a text input if children are omitted. */
    children?: React.ReactNode;
    /** Placeholder for the default input. */
    placeholder?: string;
}
/** Labelled form field wrapper. Pass a custom control as children, or use the default input. */
declare function Field({ label, id, error, required, children, placeholder }: FieldProps): React.JSX.Element;

type VerdictTone = "ok" | "warning" | "danger";
interface VerdictBannerProps extends React.HTMLAttributes<HTMLDivElement> {
    /** ok = covered/enough · warning = low/reorder soon · danger = shortage/over-budget. */
    tone?: VerdictTone;
    /** Optional leading icon (emoji or node). Defaults by tone. */
    icon?: React.ReactNode;
}
/**
 * Domain component: the one-line verdict from a stock-coverage or budget check
 * (e.g. "⛔ نقص حرج — الغطاء 4 أيام < مهلة 5 أيام. اطلب الآن").
 */
declare function VerdictBanner({ tone, icon, children, className, ...rest }: VerdictBannerProps): React.JSX.Element;

interface TabItem {
    /** Stable key. */ id: string;
    /** Visible label. */ label: React.ReactNode;
}
interface TabsProps {
    items: TabItem[];
    /** Controlled active tab id. */ value: string;
    /** Called with the newly selected tab id. */ onChange: (id: string) => void;
    /** Accessible label for the tablist. */ ariaLabel?: string;
}
/** DOM id for a tab button, derived from the tab id. Stable so consumers can reference it. */
declare function tabId(id: string): string;
/**
 * DOM id for the panel a tab controls. Consumers rendering their own panels should set this
 * `id` plus `role="tabpanel"` and `aria-labelledby={tabId(id)}` on the panel element so the
 * `aria-controls` wired here resolves. See the component doc-comment for the full pattern.
 */
declare function tabPanelId(id: string): string;
/**
 * Horizontal tab switcher (also used for accounting/inventory sub-views).
 *
 * Renders only the tab buttons; panels are rendered by the consumer. Implements the
 * WAI-ARIA tabs pattern: roving tabindex (only the active tab is in the tab order) and
 * ArrowLeft/ArrowRight/Home/End keyboard navigation that activates the focused tab.
 *
 * Each tab carries `id={tabId(it.id)}`; the *active* tab also carries
 * `aria-controls={tabPanelId(it.id)}`. Consumers render only the active panel, so inactive
 * tabs omit `aria-controls` to avoid pointing at an id not in the DOM. For the active tab's
 * `aria-controls` link to resolve, the consumer's panel should render:
 *
 * ```tsx
 * <div role="tabpanel" id={tabPanelId(id)} aria-labelledby={tabId(id)} tabIndex={0}>…</div>
 * ```
 *
 * RTL note: keyboard navigation is logical (ArrowRight = next tab in array order). Under a
 * `dir="rtl"` container the visual order is mirrored, so we detect the tablist's computed
 * direction and swap Arrow handling so ArrowRight moves to the *previous* tab (toward the
 * visual right), matching the WAI-ARIA RTL recommendation.
 */
declare function Tabs({ items, value, onChange, ariaLabel }: TabsProps): React.JSX.Element;

type IconButtonVariant = "primary" | "ghost" | "danger";
type IconButtonSize = "md" | "sm";
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Accessible name — required because the visible content is an icon only. */
    label: string;
    /** Visual style. */
    variant?: IconButtonVariant;
    /** Control size. */
    size?: IconButtonSize;
    /** Shows a spinner and disables interaction. */
    loading?: boolean;
    /** The icon (emoji or node). */
    children: React.ReactNode;
}
/** Square, icon-only button. `label` provides the accessible name (aria-label). */
declare const IconButton: React.ForwardRefExoticComponent<IconButtonProps & React.RefAttributes<HTMLButtonElement>>;

type InputSize = "md" | "sm";
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
    /** Control size (named `inputSize` so it does not collide with the native `size` attribute). */
    inputSize?: InputSize;
    /** Marks the field invalid; sets `aria-invalid` and the error border. */
    invalid?: boolean;
}
/** Single-line text control. Controlled-first; compose with `FormRow` for label/help/error. */
declare const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>>;

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** Marks the field invalid; sets `aria-invalid` and the error border. */
    invalid?: boolean;
}
/** Multi-line text control. Controlled-first; compose with `FormRow` for label/help/error. */
declare const Textarea: React.ForwardRefExoticComponent<TextareaProps & React.RefAttributes<HTMLTextAreaElement>>;

interface NumberFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange" | "size"> {
    /** Controlled numeric value (`""` while the field is empty). */
    value?: number | "";
    /** Uncontrolled initial value. */
    defaultValue?: number;
    /** Called with the parsed value on every change/step. */
    onValueChange?: (value: number | "") => void;
    /** Step increment for the buttons and arrow keys. */
    step?: number;
    min?: number;
    max?: number;
    /** Marks the field invalid; sets `aria-invalid`. */
    invalid?: boolean;
    /** Accessible name for the decrement button. */
    decrementLabel: string;
    /** Accessible name for the increment button. */
    incrementLabel: string;
}
/** Numeric input with stepper buttons. Controlled via `value`/`onValueChange`, or uncontrolled. */
declare const NumberField: React.ForwardRefExoticComponent<NumberFieldProps & React.RefAttributes<HTMLInputElement>>;

interface SelectOption {
    value: string;
    label: React.ReactNode;
    disabled?: boolean;
}
type SelectSize = "md" | "sm";
interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
    /** The options to render. */
    options: SelectOption[];
    /** Optional disabled placeholder shown first. */
    placeholder?: string;
    /** Control size. */
    selectSize?: SelectSize;
    /** Marks the field invalid; sets `aria-invalid`. */
    invalid?: boolean;
}
/** Native single-select. Controlled-first; pass `options`; compose with `FormRow`. */
declare const Select: React.ForwardRefExoticComponent<SelectProps & React.RefAttributes<HTMLSelectElement>>;

interface ComboboxOption {
    value: string;
    label: string;
}
interface ComboboxProps {
    /** Selectable options. */
    options: ComboboxOption[];
    /** Controlled text/selection value (matches an option label when selected). */
    value?: string;
    /** Called with the chosen option label (or the typed text on free edit). */
    onValueChange?: (value: string) => void;
    /** Placeholder for the editable input. */
    placeholder?: string;
    /** Marks the field invalid; sets `aria-invalid`. */
    invalid?: boolean;
    /** Stable id (used to wire listbox/option ids). */
    id?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    disabled?: boolean;
    className?: string;
}
/** Editable autocomplete. ARIA combobox + listbox/option, arrow-key navigation, Enter/Escape. */
declare const Combobox: React.ForwardRefExoticComponent<ComboboxProps & React.RefAttributes<HTMLInputElement>>;

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
    /** Visible label, associated to the input. */
    label: React.ReactNode;
    /** Marks the field invalid; sets `aria-invalid`. */
    invalid?: boolean;
}
/** Labelled checkbox. Controlled via `checked`/`onChange`, or uncontrolled with `defaultChecked`. */
declare const Checkbox: React.ForwardRefExoticComponent<CheckboxProps & React.RefAttributes<HTMLInputElement>>;

interface RadioOption {
    value: string;
    label: React.ReactNode;
    disabled?: boolean;
}
interface RadioGroupProps {
    /** Shared radio `name` (groups the inputs). */
    name: string;
    /** The options to render. */
    options: RadioOption[];
    /** Controlled selected value. */
    value?: string;
    /** Uncontrolled initial value. */
    defaultValue?: string;
    /** Called with the newly selected value. */
    onValueChange?: (value: string) => void;
    /** Group label (rendered as the fieldset legend). */
    legend: React.ReactNode;
    /** Marks the group invalid; sets `aria-invalid` on the fieldset. */
    invalid?: boolean;
    /** Disables the whole group. */
    disabled?: boolean;
    className?: string;
}
/** Radio group as a `<fieldset>` + `<legend>` wrapping native radios. Controlled-first. */
declare function RadioGroup({ name, options, value, defaultValue, onValueChange, legend, invalid, disabled, className, }: RadioGroupProps): React.JSX.Element;

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "type"> {
    /** Accessible name for the switch. */
    label: string;
    /** Controlled on/off state. */
    checked?: boolean;
    /** Uncontrolled initial state. */
    defaultChecked?: boolean;
    /** Called with the next state on toggle. */
    onCheckedChange?: (checked: boolean) => void;
}
/** Toggle switch as `role="switch"`. Keyboard: Space/Enter (native button) toggles. */
declare const Switch: React.ForwardRefExoticComponent<SwitchProps & React.RefAttributes<HTMLButtonElement>>;

type DateFieldSize = "md" | "sm";
interface DateFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
    /** Control size. */
    fieldSize?: DateFieldSize;
    /** Marks the field invalid; sets `aria-invalid`. */
    invalid?: boolean;
}
/**
 * Native date control (`<input type="date">`). Value is the ISO `yyyy-mm-dd` string;
 * the browser renders the locale display. Presentational only — no i18n in the library.
 */
declare const DateField: React.ForwardRefExoticComponent<DateFieldProps & React.RefAttributes<HTMLInputElement>>;

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
    /** Show the required marker. */
    required?: boolean;
}
/** Field label. Renders a required marker when `required`. */
declare function Label({ required, children, className, ...rest }: LabelProps): React.JSX.Element;
interface HelpProps extends React.HTMLAttributes<HTMLDivElement> {
}
/** Secondary help text under a control. */
declare function Help({ children, className, ...rest }: HelpProps): React.JSX.Element;
interface FieldErrorProps extends React.HTMLAttributes<HTMLDivElement> {
}
/** Error message under a control. Announced via `role="alert"`. */
declare function FieldError({ children, className, ...rest }: FieldErrorProps): React.JSX.Element;
interface FormRowProps {
    /** Stable id; the control gets `id`, help/error get `${id}-help` / `${id}-error`. */
    id: string;
    /** Field label. */
    label: React.ReactNode;
    /** Optional help text. */
    help?: React.ReactNode;
    /** Optional error message; presence sets `aria-invalid` on the control. */
    error?: React.ReactNode;
    /** Marks the field required (label marker + `required` on the control). */
    required?: boolean;
    /** The single control element (Input, Select, Combobox, …). */
    children: React.ReactElement;
}
/**
 * Standard label + help + error layout. Clones the child control to inject
 * `id`, `required`, `aria-invalid`, and `aria-describedby` (help and/or error).
 */
declare function FormRow({ id, label, help, error, required, children }: FormRowProps): React.JSX.Element;

type StatTrend = "up" | "down" | "flat";
interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Metric label. */
    label: React.ReactNode;
    /** The main value (use the `unit` slot for the suffix). */
    value: React.ReactNode;
    /** Small unit/suffix shown after the value (e.g. "كجم"). */
    unit?: React.ReactNode;
    /** Optional caption shown under the value. */
    help?: React.ReactNode;
    /** Direction of the change — colors the change line. */
    trend?: StatTrend;
    /** Optional change line (e.g. "+٨٪"); colored by `trend`. */
    change?: React.ReactNode;
}
/** Inline metric: label, large tabular value + unit, optional trend change line and help caption. */
declare function Stat({ label, value, unit, help, trend, change, className, ...rest }: StatProps): React.JSX.Element;

type SortDirection = "asc" | "desc";
interface SortState {
    /** Active sorted column id. */ columnId: string;
    /** Sort direction. */ direction: SortDirection;
}
interface DataTableColumn<Row> {
    /** Stable column id (matches `SortState.columnId`). */
    id: string;
    /** Header content. */
    header: React.ReactNode;
    /** Cell renderer for a row. */
    cell: (row: Row) => React.ReactNode;
    /** Whether this column is sortable. */
    sortable?: boolean;
    /** Logical alignment of the cell content. */
    align?: "start" | "center" | "end";
    /** Numeric column — applies tabular-nums + end alignment by default. */
    numeric?: boolean;
    /** Optional fixed width (any CSS length). */
    width?: string;
}
interface DataTableProps<Row> extends Omit<React.TableHTMLAttributes<HTMLTableElement>, "children"> {
    /** Column definitions. */
    columns: DataTableColumn<Row>[];
    /** Row data. */
    rows: Row[];
    /** Stable id per row (used as the React key). */
    getRowId: (row: Row) => string;
    /** Accessible caption / table name. */
    caption?: React.ReactNode;
    /** Controlled sort state (or null for unsorted). */
    sort?: SortState | null;
    /** Called with the next sort state when a sortable header is activated. */
    onSortChange?: (next: SortState) => void;
    /** Sticky header on vertical scroll. */
    stickyHeader?: boolean;
    /** Content shown (spanning all columns) when `rows` is empty. */
    empty?: React.ReactNode;
    /**
     * Narrow-screen behaviour (below ~48rem):
     * - `"cards"` (default): the table reflows into one stacked card per row,
     *   each cell shown as a `label: value` pair. The desktop table is unchanged.
     * - `"scroll"`: legacy behaviour — the wide table horizontal-scrolls.
     */
    reflow?: "cards" | "scroll";
}
/**
 * Generic, controlled-sort data table. RTL-first, sticky header optional,
 * numeric columns are tabular-nums. Sortable headers are keyboard-operable
 * buttons carrying `aria-sort`.
 */
declare function DataTable<Row>({ columns, rows, getRowId, caption, sort, onSortChange, stickyHeader, empty, reflow, className, ...rest }: DataTableProps<Row>): React.JSX.Element;

type TimelineTone = "default" | "success" | "warning" | "danger" | "info";
interface TimelineItem {
    /** Stable key. */ id: string;
    /** Event title. */ title: React.ReactNode;
    /** Optional timestamp/label. */ time?: React.ReactNode;
    /** Optional detail line. */ description?: React.ReactNode;
    /** Marker tone. */ tone?: TimelineTone;
    /** Optional icon shown inside the marker. */ icon?: React.ReactNode;
}
interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
    /** Ordered events, newest-first or oldest-first (consumer's choice). */
    items: TimelineItem[];
}
/** Vertical event timeline. Renders an ordered list with a connecting rail and toned markers. */
declare function Timeline({ items, className, ...rest }: TimelineProps): React.JSX.Element;

interface DescriptionItem {
    /** Stable key. */ id: string;
    /** Term (label). */ term: React.ReactNode;
    /** Description (value). */ description: React.ReactNode;
    /** Numeric value — applies tabular-nums. */ numeric?: boolean;
}
interface DescriptionListProps extends React.HTMLAttributes<HTMLDListElement> {
    /** Term/description pairs. */
    items: DescriptionItem[];
    /** `stacked` (term above value) or `inline` (term beside value). */
    layout?: "stacked" | "inline";
}
/** Semantic key/value list (`<dl>`). Use for record metadata; numeric values are tabular-nums. */
declare function DescriptionList({ items, layout, className, ...rest }: DescriptionListProps): React.JSX.Element;

type AvatarSize = "sm" | "md" | "lg";
interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Full name — used as the accessible label and to derive initials. */
    name: string;
    /** Optional image URL; falls back to initials. */
    src?: string;
    /** Visual size. */
    size?: AvatarSize;
}
/** User/entity avatar. Shows an image when `src` is set, otherwise initials. `name` labels it. */
declare const Avatar: React.ForwardRefExoticComponent<AvatarProps & React.RefAttributes<HTMLSpanElement>>;

type TooltipPlacement = "top" | "bottom" | "start" | "end";
interface TooltipProps {
    /** Tooltip text/content. */
    label: React.ReactNode;
    /** Logical placement relative to the trigger. */
    placement?: TooltipPlacement;
    /** A single focusable trigger element. */
    children: React.ReactElement;
}
/**
 * Accessible tooltip. Wraps one focusable child; shows a `role="tooltip"` bubble on
 * hover + focus, links it via `aria-describedby`, dismisses on `Esc`.
 */
declare function Tooltip({ label, placement, children }: TooltipProps): React.JSX.Element;

interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
    /** Current page (1-based). */
    page: number;
    /** Total number of pages. */
    pageCount: number;
    /** Called with the next page (1-based). */
    onChange: (page: number) => void;
    /** Accessible label for the nav region. */
    ariaLabel?: string;
    /** Previous-button content (consumer supplies the string). */
    prevLabel?: React.ReactNode;
    /** Next-button content (consumer supplies the string). */
    nextLabel?: React.ReactNode;
}
/** Controlled pagination. `<nav>` with prev/next + numbered pages; current page uses `aria-current`. */
declare function Pagination({ page, pageCount, onChange, ariaLabel, prevLabel, nextLabel, className, ...rest }: PaginationProps): React.JSX.Element;

interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Headline (e.g. "لا توجد طلبات"). */
    title: React.ReactNode;
    /** Optional supporting line. */
    description?: React.ReactNode;
    /** Optional decorative icon. */
    icon?: React.ReactNode;
    /** Optional action slot (e.g. a Button). */
    action?: React.ReactNode;
}
/** Centered empty/zero-data placeholder: icon, title, description, optional action. */
declare function EmptyState({ title, description, icon, action, className, ...rest }: EmptyStateProps): React.JSX.Element;

type SkeletonShape = "text" | "rect" | "circle";
interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Visual shape. `text` supports multiple `lines`. */
    shape?: SkeletonShape;
    /** Explicit width (number → px). */
    width?: string | number;
    /** Explicit height (number → px). */
    height?: string | number;
    /** Number of stacked bars when `shape="text"`. */
    lines?: number;
}
/** Token-driven shimmer placeholder (decorative; `aria-hidden`). Shimmer uses color-mix over --neutral-bg. */
declare function Skeleton({ shape, width, height, lines, className, style, ...rest }: SkeletonProps): React.JSX.Element;

type ModalSize = "sm" | "md" | "lg";
interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Whether the modal is open. Controlled. */
    open: boolean;
    /** Called when the user requests to close (Esc, backdrop, close button). */
    onClose: () => void;
    /** Heading shown in the header; also names the dialog for assistive tech. */
    title?: React.ReactNode;
    /** Optional footer region (e.g. action buttons), pinned below the body. */
    footer?: React.ReactNode;
    /** Width preset. */
    size?: ModalSize;
    /** Close when the backdrop is clicked. Default true. */
    closeOnBackdrop?: boolean;
    /** Close on the Escape key. Default true. */
    closeOnEsc?: boolean;
    /** Accessible label for the × close button (consumer-supplied — no i18n in lib). */
    closeLabel?: string;
    children: React.ReactNode;
}
/** Accessible, portal-rendered modal dialog. Re-applies the active theme inside the portal. */
declare function Modal({ open, onClose, title, footer, size, closeOnBackdrop, closeOnEsc, closeLabel, className, children, ...rest }: ModalProps): React.ReactPortal | null;
/** Alias — Dialog is the same component. */
declare const Dialog: typeof Modal;

type DrawerSide = "start" | "end";
interface DrawerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Whether the drawer is open. Controlled. */
    open: boolean;
    /** Called when the user requests to close (Esc, backdrop, close button). */
    onClose: () => void;
    /** Inline edge to dock to. Logical — auto-flips under RTL. Default "end". */
    side?: DrawerSide;
    /** Heading; also names the dialog for assistive tech. */
    title?: React.ReactNode;
    /** Optional pinned footer region. */
    footer?: React.ReactNode;
    /** Close when the backdrop is clicked. Default true. */
    closeOnBackdrop?: boolean;
    /** Close on the Escape key. Default true. */
    closeOnEsc?: boolean;
    /** Accessible label for the × close button (consumer-supplied). */
    closeLabel?: string;
    children: React.ReactNode;
}
/** Accessible, portal-rendered side sheet. Slides from the inline `side` (RTL-aware). */
declare function Drawer({ open, onClose, side, title, footer, closeOnBackdrop, closeOnEsc, closeLabel, className, children, ...rest }: DrawerProps): React.ReactPortal | null;
/** Alias — Sheet is the same component. */
declare const Sheet: typeof Drawer;

type ConfirmTone = "primary" | "danger";
interface ConfirmDialogProps extends Pick<ModalProps, "open" | "onClose" | "title" | "size" | "closeOnBackdrop" | "closeOnEsc" | "closeLabel"> {
    /** Optional body copy explaining the consequence. */
    description?: React.ReactNode;
    /** Confirm button text (consumer-supplied). */
    confirmLabel: string;
    /** Cancel button text (consumer-supplied). */
    cancelLabel: string;
    /** `danger` renders a destructive confirm button. Default "primary". */
    tone?: ConfirmTone;
    /** Disables + spins the confirm button (async confirm). */
    loading?: boolean;
    /** Called when the confirm button is pressed. */
    onConfirm: () => void;
}
/** A confirm/cancel dialog built on Modal. Reuses Modal's open/close/title surface. */
declare function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel, tone, loading, size, closeOnBackdrop, closeOnEsc, closeLabel, }: ConfirmDialogProps): React.ReactElement;

type ToastTone = "ok" | "info" | "warning" | "danger";
interface ToastOptions {
    /** Bold heading line. */
    title: React.ReactNode;
    /** Optional muted second line. */
    description?: React.ReactNode;
    /** Severity. Default "info". */
    tone?: ToastTone;
    /** Auto-dismiss after N ms. `0` or negative = sticky. Default 4500. */
    duration?: number;
    /** Optional leading icon (emoji or node). */
    icon?: React.ReactNode;
}
interface ToastRecord extends ToastOptions {
    id: string;
}
type ShorthandOpts = Omit<ToastOptions, "title" | "tone">;
interface ToastApi {
    toast(opts: ToastOptions): string;
    dismiss(id: string): void;
    clear(): void;
    ok(title: React.ReactNode, opts?: ShorthandOpts): string;
    info(title: React.ReactNode, opts?: ShorthandOpts): string;
    warning(title: React.ReactNode, opts?: ShorthandOpts): string;
    danger(title: React.ReactNode, opts?: ShorthandOpts): string;
}
interface ToastProviderProps {
    children: React.ReactNode;
    /** Max simultaneous toasts; oldest is dropped past this. Default 4. */
    max?: number;
}
declare function ToastProvider({ children, max }: ToastProviderProps): React.JSX.Element;
declare function useToast(): ToastApi;
/** The live region that renders queued toasts. Auto-mounted by ToastProvider. */
declare function Toaster(): React.ReactPortal | null;

interface NavItemData {
    /** Stable key. */ id: string;
    /** Visible label (consumer-supplied). */ label: React.ReactNode;
    /** Optional leading icon (emoji or node). */ icon?: React.ReactNode;
    /** Link target; when omitted the item renders as a <button>. */ href?: string;
    /** Roles allowed to see this item. Omitted = visible to all roles. */ roles?: string[];
}
interface NavItemProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onSelect"> {
    /** The nav entry to render. */ item: NavItemData;
    /** Marks the active route → aria-current="page". */ active?: boolean;
    /** Called with the item id on activation (SPA routing). */ onSelect?: (id: string) => void;
}
/** A single sidebar entry. Renders an <a> (preferred for routing) carrying aria-current when active. */
declare const NavItem: React.ForwardRefExoticComponent<NavItemProps & React.RefAttributes<HTMLAnchorElement>>;

interface SidebarNavProps extends Omit<React.HTMLAttributes<HTMLElement>, "onSelect"> {
    /** Nav entries (consumer-supplied). */ items: NavItemData[];
    /** Active item id → that NavItem gets aria-current="page". */ activeId?: string;
    /** Filter items to those visible to this role (matches NavItemData.roles). */ role?: string;
    /** Accessible name for the <nav> landmark. */ ariaLabel: string;
    /** Bubbled up from NavItem clicks. */ onSelect?: (id: string) => void;
}
/** Vertical primary navigation. A <nav> landmark + list; the active item carries aria-current. */
declare function SidebarNav({ items, activeId, role, ariaLabel, onSelect, className, ...rest }: SidebarNavProps): React.JSX.Element;

interface Crumb {
    /** Stable key. */ id: string;
    /** Visible label (consumer-supplied). */ label: React.ReactNode;
    /** Link target; omit on the current page (rendered as plain text). */ href?: string;
}
interface BreadcrumbsProps extends Omit<React.HTMLAttributes<HTMLElement>, "onSelect"> {
    /** Ordered trail; the last item is treated as the current page. */ items: Crumb[];
    /** Accessible name for the breadcrumb <nav>. */ ariaLabel: string;
    /** Separator between crumbs (decorative). */ separator?: React.ReactNode;
    /** Bubbled up from crumb link clicks. */ onSelect?: (id: string) => void;
}
/** Breadcrumb trail. <nav aria-label> + ordered list; the last crumb is aria-current="page" text. */
declare function Breadcrumbs({ items, ariaLabel, separator, onSelect, className, ...rest }: BreadcrumbsProps): React.JSX.Element;

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
    /** Accessible label for the field (consumer-supplied; visually hidden). */ label: string;
    /** Controlled value. */ value: string;
    /** Change handler (controlled-first). */ onValueChange: (value: string) => void;
    /** Leading icon (decorative). */ icon?: React.ReactNode;
    /** Fired on Enter with the current value. */ onSubmitSearch?: (value: string) => void;
}
/** Search field. role="search" wrapper + a labeled <input type="search">. */
declare const SearchInput: React.ForwardRefExoticComponent<SearchInputProps & React.RefAttributes<HTMLInputElement>>;

interface RoleOption {
    /** Role key (e.g. "owner"). */ id: string;
    /** Visible label (consumer-supplied). */ label: React.ReactNode;
}
interface RoleSwitcherProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
    /** Selectable roles. */ options: RoleOption[];
    /** Controlled active role id. */ value: string;
    /** Called with the newly selected role id. */ onRoleChange: (id: string) => void;
    /** Accessible label (consumer-supplied; visually hidden). */ label: string;
}
/** Role switcher — an accessible native <select> (combobox) of roles. */
declare const RoleSwitcher: React.ForwardRefExoticComponent<RoleSwitcherProps & React.RefAttributes<HTMLSelectElement>>;

interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Nav entries (consumer-supplied; filtered by role). */ navItems: NavItemData[];
    /** Active nav item id → aria-current="page". */ activeNavId?: string;
    /** Current role; filters navItems via NavItemData.roles. */ role?: string;
    /** Accessible name for the sidebar <nav>. */ navAriaLabel: string;
    /** Bubbled up from sidebar item activation. */ onNavSelect?: (id: string) => void;
    /** Brand / logo slot. */ brand?: React.ReactNode;
    /** Topbar content (search, role switcher, user menu…). */ topbar?: React.ReactNode;
    /** Controlled mobile-drawer open state. Uncontrolled if omitted. */ sidebarOpen?: boolean;
    /** Notified when the drawer toggles (hamburger / overlay / Esc). */ onSidebarOpenChange?: (open: boolean) => void;
    /** Accessible label for the hamburger toggle. */ menuButtonLabel: string;
    /** Main content. */ children: React.ReactNode;
}
/**
 * Application frame: a fixed topbar (banner) + an inline-start sidebar (primary nav) + a main region.
 * RTL-first: the sidebar anchors to the inline-start edge via logical grid columns; under dir="rtl"
 * that is the right edge, under dir="ltr" the left — no code change. On narrow viewports the sidebar
 * collapses to an off-canvas drawer toggled from the topbar hamburger (overlay click / Esc closes it).
 */
declare function AppShell({ navItems, activeNavId, role, navAriaLabel, onNavSelect, brand, topbar, sidebarOpen, onSidebarOpenChange, menuButtonLabel, children, className, ...rest }: AppShellProps): React.JSX.Element;

type LoopStepState = "pending" | "active" | "done" | "blocked";
interface LoopStep {
    id: string;
    label: React.ReactNode;
    state?: LoopStepState;
}
interface LoopStepperProps extends React.HTMLAttributes<HTMLOListElement> {
    steps: LoopStep[];
    ariaLabel: string;
}
/**
 * Domain component: the planning-loop stepper (plan → check → approve → execute → file).
 * Horizontal, RTL-first, an ordered list; the active step carries aria-current="step".
 * Labels are consumer-supplied (no strings in the library).
 */
declare function LoopStepper({ steps, ariaLabel, className, ...rest }: LoopStepperProps): React.JSX.Element;

type PhaseTone = "neutral" | "info" | "ok" | "warning" | "danger";
interface PhaseMetaRow {
    label: React.ReactNode;
    value: React.ReactNode;
}
interface PhaseCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    title: React.ReactNode;
    tone?: PhaseTone;
    status?: React.ReactNode;
    meta?: PhaseMetaRow[];
    progress?: number;
    progressLabel?: string;
}
/** Domain component: a card summarizing a plan phase/operation (title, status tone, meta rows, progress). */
declare function PhaseCard({ title, tone, status, meta, progress, progressLabel, className, ...rest }: PhaseCardProps): React.JSX.Element;

type PillStatus = "draft" | "scheduled" | "active" | "done" | "warning" | "blocked";
interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
    status: PillStatus;
    dot?: boolean;
}
/**
 * Domain status indicator (Farm-OS status set). Tone is semantic, never decorative —
 * the consumer-supplied label must carry the meaning too.
 */
declare function StatusPill({ status, dot, children, className, ...rest }: StatusPillProps): React.JSX.Element;

type PalmStatus = "healthy" | "watch" | "sick" | "dead" | "removed" | "male";
interface PalmCellProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
    status: PalmStatus;
    ariaLabel: string;
    glyph?: React.ReactNode;
    selected?: boolean;
}
/**
 * Domain unit: a single palm cell in the grid map. A focusable button colored by
 * palm status (via role-token modifier class). The accessible label (status + position)
 * is consumer-supplied — the library holds no strings.
 */
declare function PalmCell({ status, ariaLabel, glyph, selected, className, type, ...rest }: PalmCellProps): React.JSX.Element;

interface PalmCellData {
    id: string;
    status: PalmStatus;
    ariaLabel: string;
    glyph?: React.ReactNode;
    selected?: boolean;
}
interface PalmLine {
    id: string;
    label: React.ReactNode;
    cells: PalmCellData[];
}
interface PalmGridProps extends React.HTMLAttributes<HTMLDivElement> {
    lines: PalmLine[];
    ariaLabel: string;
    onCellActivate?: (cellId: string, lineId: string) => void;
}
/**
 * Domain component: a grid map of palms laid out by line, inside a horizontal-scroll
 * container with line labels. Cells are PalmCell buttons; status→token mapping lives in PalmCell.
 */
declare function PalmGrid({ lines, ariaLabel, onCellActivate, className, ...rest }: PalmGridProps): React.JSX.Element;

type TimelineKind = "operation" | "issue" | "inspection" | "expense" | "photo";
interface TimelineEvent {
    id: string;
    kind: TimelineKind;
    title: React.ReactNode;
    time: React.ReactNode;
    description?: React.ReactNode;
    glyph?: React.ReactNode;
}
interface FileTimelineProps extends React.HTMLAttributes<HTMLOListElement> {
    events: TimelineEvent[];
    ariaLabel: string;
}
/**
 * Domain component: a vertical RTL timeline of farm events. Markers sit on the
 * inline-start edge, tone-coded by event kind. Titles/times are consumer-supplied.
 */
declare function FileTimeline({ events, ariaLabel, className, ...rest }: FileTimelineProps): React.JSX.Element;

type ApprovalState = "requested" | "pending" | "approved" | "rejected";
interface ApprovalStep {
    id: string;
    state: ApprovalState;
    actor: React.ReactNode;
    note?: React.ReactNode;
}
interface ApprovalChainProps extends React.HTMLAttributes<HTMLOListElement> {
    steps: ApprovalStep[];
    ariaLabel: string;
}
/**
 * Domain component: an approval sequence (requested → reviewer → approved/rejected)
 * as an ordered list. The pending (current reviewer) step carries aria-current="step".
 * Actor labels are consumer-supplied.
 */
declare function ApprovalChain({ steps, ariaLabel, className, ...rest }: ApprovalChainProps): React.JSX.Element;

type ThemeScheme = "light" | "dark";
type Density = "comfortable" | "compact";
type Radius = "sharp" | "default" | "rounded";
interface ThemeContextValue {
    scheme: ThemeScheme;
    density: Density;
    radius: Radius;
    brand?: string;
    /** Resolved brand CSS variables ({} when unset/invalid). Spread onto portal roots
     *  (Modal/Drawer/Toaster) so the white-label brand reaches content rendered outside
     *  the provider's subtree. */
    brandStyle: React.CSSProperties;
}
declare const useTheme: () => ThemeContextValue;
interface ThemeProviderProps {
    scheme?: ThemeScheme;
    density?: Density;
    radius?: Radius;
    brand?: string;
    className?: string;
    children: React.ReactNode;
}
declare function ThemeProvider({ scheme, density, radius, brand, className, children, }: ThemeProviderProps): React.JSX.Element;

/** Derive brand role variables from a single hex color. */
declare function brandVars(hex: string): Record<string, string>;

export { Alert, type AlertProps, type AlertTone, AppShell, type AppShellProps, ApprovalChain, type ApprovalChainProps, type ApprovalState, type ApprovalStep, Avatar, type AvatarProps, type AvatarSize, Breadcrumbs, type BreadcrumbsProps, Button, type ButtonProps, type ButtonSize, type ButtonVariant, Card, type CardProps, Checkbox, type CheckboxProps, Combobox, type ComboboxOption, type ComboboxProps, ConfirmDialog, type ConfirmDialogProps, type ConfirmTone, type Crumb, DataTable, type DataTableColumn, type DataTableProps, DateField, type DateFieldProps, type DateFieldSize, type Density, type DescriptionItem, DescriptionList, type DescriptionListProps, Dialog, Drawer, type DrawerProps, type DrawerSide, EmptyState, type EmptyStateProps, Field, FieldError, type FieldErrorProps, type FieldProps, FileTimeline, type FileTimelineProps, FormRow, type FormRowProps, Help, type HelpProps, IconButton, type IconButtonProps, type IconButtonSize, type IconButtonVariant, Input, type InputProps, type InputSize, KpiCard, type KpiCardProps, Label, type LabelProps, type LoopStep, type LoopStepState, LoopStepper, type LoopStepperProps, Modal, type ModalProps, type ModalSize, NavItem, type NavItemData, type NavItemProps, NumberField, type NumberFieldProps, Pagination, type PaginationProps, PalmCell, type PalmCellData, type PalmCellProps, PalmGrid, type PalmGridProps, type PalmLine, type PalmStatus, PhaseCard, type PhaseCardProps, type PhaseMetaRow, type PhaseTone, type PillStatus, Progress, type ProgressProps, type ProgressTone, RadioGroup, type RadioGroupProps, type RadioOption, type Radius, type RoleOption, RoleSwitcher, type RoleSwitcherProps, SearchInput, type SearchInputProps, Select, type SelectOption, type SelectProps, type SelectSize, Sheet, SidebarNav, type SidebarNavProps, Skeleton, type SkeletonProps, type SkeletonShape, type SortDirection, type SortState, Stat, type StatProps, type StatTrend, StatusPill, type StatusPillProps, Switch, type SwitchProps, type TabItem, Tabs, type TabsProps, Tag, type TagProps, type TagTone, Textarea, type TextareaProps, type ThemeContextValue, ThemeProvider, type ThemeProviderProps, type ThemeScheme, Timeline, type TimelineEvent, type TimelineItem, type TimelineKind, type TimelineProps, type TimelineTone, type ToastApi, type ToastOptions, ToastProvider, type ToastProviderProps, type ToastRecord, type ToastTone, Toaster, Tooltip, type TooltipPlacement, type TooltipProps, VerdictBanner, type VerdictBannerProps, type VerdictTone, brandVars, tabId, tabPanelId, useTheme, useToast };
