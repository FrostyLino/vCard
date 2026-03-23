import {
  cloneElement,
  isValidElement,
  useId,
  type ReactNode,
} from "react";
import { DateInputField } from "./DateInputField";
import { unfoldVCardLines } from "../lib/vcard/utils";
import type {
  AddressValue,
  ContactValue,
  ValidationIssue,
  VCardDocument,
} from "../lib/vcard";

type ContactKind = "email" | "phone" | "url" | "impp";
type ContactListKey = "emails" | "phones" | "urls" | "impps";
type TextFieldKey =
  | "formattedName"
  | "title"
  | "role"
  | "birthday"
  | "anniversary"
  | "note";

export interface DocumentEditorController {
  updateTextField: (field: TextFieldKey, value: string) => void;
  updateStructuredNameField: (field: keyof VCardDocument["name"], value: string) => void;
  updateNicknames: (value: string) => void;
  updateOrganization: (value: string) => void;
  addContactEntry: (listKey: ContactListKey) => void;
  updateContactEntry: (
    listKey: ContactListKey,
    index: number,
    update: (entry: ContactValue) => ContactValue,
  ) => void;
  moveContactEntry: (listKey: ContactListKey, index: number, direction: -1 | 1) => void;
  removeContactEntry: (listKey: ContactListKey, index: number) => void;
  addAddressEntry: () => void;
  updateAddressEntry: (index: number, update: (entry: AddressValue) => AddressValue) => void;
  moveAddressEntry: (index: number, direction: -1 | 1) => void;
  removeAddressEntry: (index: number) => void;
  choosePhoto: () => void;
  removePhoto: () => void;
}

interface DocumentFormProps {
  document: VCardDocument;
  controller: DocumentEditorController;
}

interface DocumentInsightsPanelProps {
  parseWarnings: string[];
  issues: ValidationIssue[];
  unknownPropertyCount: number;
  document: VCardDocument;
  serializedDocument: string;
}

export function DocumentForm({ document, controller }: DocumentFormProps) {
  return (
    <>
      <SectionCard
        title="Profile image"
        description="Embed a portrait directly into the vCard so the file stays portable."
      >
        <div className="photo-card">
          {document.photo ? (
            <div className="photo-frame">
              <img
                src={document.photo.uri}
                alt="Contact profile"
                className="photo-frame__image"
              />
            </div>
          ) : (
            <div className="photo-frame photo-frame--empty">
              <span className="photo-frame__placeholder">No image selected</span>
            </div>
          )}

          <div className="photo-meta">
            <h3>{document.photo ? "Current profile image" : "No profile image yet"}</h3>
            <p>
              {document.photo
                ? document.photo.isEmbedded
                  ? "This image is embedded into the .vcf file."
                  : "This photo is linked by URI and will be preserved."
                : "Choose an image to store it as the contact photo. JPEG and PNG are the safest formats for iOS and other contacts apps."}
            </p>
            {document.photo?.mediaType ? (
              <span className="status-pill">{document.photo.mediaType}</span>
            ) : null}
            <div className="photo-meta__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={controller.choosePhoto}
              >
                {document.photo ? "Replace image" : "Choose image"}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={controller.removePhoto}
                disabled={!document.photo}
              >
                Remove image
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Identity"
        description="Core name fields shown by contact apps first."
      >
        <FieldGroup
          label="Formatted name (FN)"
          hint="Required. This is the visible display name in contact apps."
          required
        >
          <input
            value={document.formattedName}
            onChange={(event) => controller.updateTextField("formattedName", event.currentTarget.value)}
            placeholder="Jane Doe"
            autoComplete="name"
            autoCapitalize="words"
          />
        </FieldGroup>

        <div className="grid grid--two">
          <FieldGroup label="Given name" hint="First name only.">
            <input
              value={document.name.given}
              onChange={(event) => controller.updateStructuredNameField("given", event.currentTarget.value)}
              placeholder="Jane"
              autoComplete="given-name"
              autoCapitalize="words"
            />
          </FieldGroup>
          <FieldGroup label="Family name" hint="Surname or last name.">
            <input
              value={document.name.family}
              onChange={(event) => controller.updateStructuredNameField("family", event.currentTarget.value)}
              placeholder="Doe"
              autoComplete="family-name"
              autoCapitalize="words"
            />
          </FieldGroup>
          <FieldGroup label="Additional names" hint="Middle names, if any.">
            <input
              value={document.name.additional}
              onChange={(event) =>
                controller.updateStructuredNameField("additional", event.currentTarget.value)
              }
              placeholder="Middle names"
              autoComplete="additional-name"
              autoCapitalize="words"
            />
          </FieldGroup>
          <FieldGroup label="Prefix" hint="Honorific, for example Dr.">
            <input
              value={document.name.prefix}
              onChange={(event) => controller.updateStructuredNameField("prefix", event.currentTarget.value)}
              placeholder="Dr."
              autoComplete="honorific-prefix"
              autoCapitalize="words"
            />
          </FieldGroup>
          <FieldGroup label="Suffix" hint="Suffix, for example Jr.">
            <input
              value={document.name.suffix}
              onChange={(event) => controller.updateStructuredNameField("suffix", event.currentTarget.value)}
              placeholder="Jr."
              autoComplete="honorific-suffix"
              autoCapitalize="words"
            />
          </FieldGroup>
          <FieldGroup
            label="Nicknames"
            hint="Comma separated. Capitalization is preserved."
          >
            <input
              value={document.nicknames.join(", ")}
              onChange={(event) => controller.updateNicknames(event.currentTarget.value)}
              placeholder="JJ, J"
              autoComplete="nickname"
            />
          </FieldGroup>
        </div>
      </SectionCard>

      <SectionCard
        title="Professional"
        description="Company details plus title and role."
      >
        <div className="grid grid--two">
          <FieldGroup label="Organization" hint="Use semicolons to separate units">
            <input
              value={document.organizationUnits.join("; ")}
              onChange={(event) => controller.updateOrganization(event.currentTarget.value)}
              placeholder="Acme GmbH; Product"
              autoComplete="organization"
              autoCapitalize="words"
            />
          </FieldGroup>
          <FieldGroup label="Title" hint="Role or job title.">
            <input
              value={document.title}
              onChange={(event) => controller.updateTextField("title", event.currentTarget.value)}
              placeholder="Design Lead"
              autoComplete="organization-title"
              autoCapitalize="words"
            />
          </FieldGroup>
          <FieldGroup
            label="Role"
            hint="Functional role in the organization, separate from the title."
          >
            <input
              value={document.role}
              onChange={(event) => controller.updateTextField("role", event.currentTarget.value)}
              placeholder="Primary client contact"
              autoComplete="off"
              autoCapitalize="words"
            />
          </FieldGroup>
        </div>
      </SectionCard>

      <SectionCard
        title="Dates"
        description="Optional structured contact dates using the YYYY-MM-DD format."
      >
        <div className="grid grid--two">
          <FieldGroup
            label="Birthday"
            hint="Use a full date such as 1988-04-12 for the best interoperability."
          >
            <DateInputField
              value={document.birthday}
              onChange={(value) => controller.updateTextField("birthday", value)}
              placeholder="1988-04-12"
              pickerLabel="Open birthday picker"
              clearLabel="Clear birthday"
            />
          </FieldGroup>
          <FieldGroup
            label="Anniversary"
            hint="Use a full date such as 2018-09-01 if you want to store it explicitly."
          >
            <DateInputField
              value={document.anniversary}
              onChange={(value) => controller.updateTextField("anniversary", value)}
              placeholder="2018-09-01"
              pickerLabel="Open anniversary picker"
              clearLabel="Clear anniversary"
            />
          </FieldGroup>
        </div>
      </SectionCard>

      <ContactSection
        title="Email addresses"
        description="Use complete email addresses. Multiple entries are supported."
        kind="email"
        addLabel="Add email"
        entries={document.emails}
        placeholder="jane@company.com"
        onAdd={() => controller.addContactEntry("emails")}
        onChange={(index, update) => controller.updateContactEntry("emails", index, update)}
        onMove={(index, direction) => controller.moveContactEntry("emails", index, direction)}
        onRemove={(index) => controller.removeContactEntry("emails", index)}
      />

      <ContactSection
        title="Phone numbers"
        description="International formatting is recommended for best sync behavior."
        kind="phone"
        addLabel="Add phone"
        entries={document.phones}
        placeholder="+49 151 23456789"
        onAdd={() => controller.addContactEntry("phones")}
        onChange={(index, update) => controller.updateContactEntry("phones", index, update)}
        onMove={(index, direction) => controller.moveContactEntry("phones", index, direction)}
        onRemove={(index) => controller.removeContactEntry("phones", index)}
      />

      <ContactSection
        title="URLs"
        description="Use complete URLs including the scheme, for example https://."
        kind="url"
        addLabel="Add URL"
        entries={document.urls}
        placeholder="https://example.com"
        onAdd={() => controller.addContactEntry("urls")}
        onChange={(index, update) => controller.updateContactEntry("urls", index, update)}
        onMove={(index, direction) => controller.moveContactEntry("urls", index, direction)}
        onRemove={(index) => controller.removeContactEntry("urls", index)}
      />

      <ContactSection
        title="Instant messaging"
        description="Use complete messaging URIs such as sip:, xmpp:, im: or msteams:."
        kind="impp"
        addLabel="Add IM URI"
        entries={document.impps}
        placeholder="xmpp:jane@example.com"
        onAdd={() => controller.addContactEntry("impps")}
        onChange={(index, update) => controller.updateContactEntry("impps", index, update)}
        onMove={(index, direction) => controller.moveContactEntry("impps", index, direction)}
        onRemove={(index) => controller.removeContactEntry("impps", index)}
      />

      <AddressSection
        entries={document.addresses}
        onAdd={controller.addAddressEntry}
        onChange={controller.updateAddressEntry}
        onMove={controller.moveAddressEntry}
        onRemove={controller.removeAddressEntry}
      />

      <SectionCard
        title="Notes"
        description="Stored as NOTE in the final vCard."
      >
        <FieldGroup label="Note" hint="Freeform text. Line breaks are preserved.">
          <textarea
            value={document.note}
            onChange={(event) => controller.updateTextField("note", event.currentTarget.value)}
            placeholder="Context, reminders or freeform metadata"
            rows={6}
            spellCheck
          />
        </FieldGroup>
      </SectionCard>
    </>
  );
}

export function DocumentInsightsPanel({
  parseWarnings,
  issues,
  unknownPropertyCount,
  document,
  serializedDocument,
}: DocumentInsightsPanelProps) {
  const previewDocument = createPreviewDocument(serializedDocument);

  return (
    <>
      <SectionCard
        title="Validation"
        description="Blocking errors prevent Save until resolved."
      >
        <ValidationList
          parseWarnings={parseWarnings}
          issues={issues}
          unknownPropertyCount={unknownPropertyCount}
        />
      </SectionCard>

      <SectionCard
        title="Managed metadata"
        description="UID and PRODID stay ready while REV is refreshed on save."
      >
        <div className="metadata-list">
          <MetadataItem label="UID" value={document.uid || "Not set yet"} />
          <MetadataItem label="REV" value={document.rev || "Not set yet"} />
          <MetadataItem label="PRODID" value={document.prodId || "Not set yet"} />
        </div>
      </SectionCard>

      <SectionCard
        title="Raw Preview"
        description="Current serialized vCard preview. Managed REV updates on save."
      >
        <pre className="preview-panel">{previewDocument}</pre>
      </SectionCard>
    </>
  );
}

interface SectionCardProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function SectionCard({ title, description, children }: SectionCardProps) {
  const headingId = `section-${useId().replace(/:/gu, "")}`;

  return (
    <section className="section-card" aria-labelledby={headingId}>
      <div className="section-card__header">
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

interface FieldGroupProps {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

interface FieldControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
}

export function FieldGroup({ label, hint, required = false, children }: FieldGroupProps) {
  const reactId = useId();
  const controlId = `field-${reactId.replace(/:/gu, "")}`;
  const hintId = hint ? `${controlId}-hint` : undefined;

  if (!isValidElement<FieldControlProps>(children)) {
    return (
      <div className="field-group">
        <span className="field-group__label">{label}</span>
        {children}
        {hint ? <span className="field-group__hint">{hint}</span> : null}
      </div>
    );
  }

  const describedBy = [children.props["aria-describedby"], hintId].filter(Boolean).join(" ") || undefined;
  const resolvedControlId = children.props.id ?? controlId;
  const control = cloneElement(children, {
    id: resolvedControlId,
    required: children.props.required ?? required,
    "aria-describedby": describedBy,
  });

  return (
    <div className="field-group">
      <div className="field-group__header">
        <label className="field-group__label" htmlFor={resolvedControlId}>
          {label}
        </label>
        {required ? <span className="field-group__required">Required</span> : null}
      </div>
      {control}
      {hint ? (
        <span className="field-group__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

interface ContactSectionProps {
  title: string;
  description: string;
  kind: ContactKind;
  addLabel: string;
  placeholder: string;
  entries: ContactValue[];
  onAdd: () => void;
  onChange: (index: number, update: (entry: ContactValue) => ContactValue) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}

export function ContactSection({
  title,
  description,
  kind,
  addLabel,
  placeholder,
  entries,
  onAdd,
  onChange,
  onMove,
  onRemove,
}: ContactSectionProps) {
  return (
    <SectionCard title={title} description={description}>
      <div className="section-card__toolbar">
        <button type="button" className="button button--ghost" onClick={onAdd}>
          {addLabel}
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="section-empty">No entries yet.</p>
      ) : (
        <div className="stack">
          {entries.map((entry, index) => (
            <article className="entry-card" key={`${entry.group ?? "entry"}-${index}`}>
              <div className="entry-card__toolbar">
                <span className="entry-card__title">Entry {index + 1}</span>
                <div className="entry-card__actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move ${title} entry ${index + 1} up`}
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move ${title} entry ${index + 1} down`}
                    onClick={() => onMove(index, 1)}
                    disabled={index === entries.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    aria-label={`Remove ${title} entry ${index + 1}`}
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="grid grid--two">
                <FieldGroup label="Value" hint={getContactValueHint(kind)}>
                  <input
                    {...getContactValueInputProps(kind)}
                    value={entry.value}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        value,
                      }));
                    }}
                    placeholder={placeholder}
                  />
                </FieldGroup>
                <FieldGroup label="Types" hint={getContactTypeHint(kind)}>
                  <input
                    value={entry.types.join(", ")}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        types: splitTypeList(value),
                      }));
                    }}
                    placeholder={getContactTypePlaceholder(kind)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </FieldGroup>
                <FieldGroup label="Label" hint="Optional human-readable display label.">
                  <input
                    value={entry.label ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        label: emptyToUndefined(value),
                      }));
                    }}
                    placeholder="Optional display label"
                    autoComplete="off"
                  />
                </FieldGroup>
                <FieldGroup
                  label="Preference"
                  hint="Optional positive number. Lower means more preferred."
                >
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={entry.pref ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        pref: parseOptionalNumber(value),
                      }));
                    }}
                    placeholder="1"
                  />
                </FieldGroup>
              </div>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

interface AddressSectionProps {
  entries: AddressValue[];
  onAdd: () => void;
  onChange: (index: number, update: (entry: AddressValue) => AddressValue) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}

export function AddressSection({ entries, onAdd, onChange, onMove, onRemove }: AddressSectionProps) {
  return (
    <SectionCard
      title="Addresses"
      description="Structured ADR fields for postal or office addresses."
    >
      <div className="section-card__toolbar">
        <button type="button" className="button button--ghost" onClick={onAdd}>
          Add address
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="section-empty">No addresses yet.</p>
      ) : (
        <div className="stack">
          {entries.map((entry, index) => (
            <article className="entry-card" key={`${entry.group ?? "address"}-${index}`}>
              <div className="entry-card__toolbar">
                <span className="entry-card__title">Address {index + 1}</span>
                <div className="entry-card__actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move address ${index + 1} up`}
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Move address ${index + 1} down`}
                    onClick={() => onMove(index, 1)}
                    disabled={index === entries.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
                    aria-label={`Remove address ${index + 1}`}
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="grid grid--two">
                <FieldGroup label="Street" hint="House number and street name.">
                  <input
                    value={entry.street}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        street: value,
                      }));
                    }}
                    placeholder="Example street 5"
                    autoComplete="address-line1"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="City" hint="Town or city.">
                  <input
                    value={entry.locality}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        locality: value,
                      }));
                    }}
                    placeholder="Berlin"
                    autoComplete="address-level2"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Region" hint="State, region or province.">
                  <input
                    value={entry.region}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        region: value,
                      }));
                    }}
                    placeholder="Berlin"
                    autoComplete="address-level1"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Postal code" hint="ZIP or postal code.">
                  <input
                    value={entry.postalCode}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        postalCode: value,
                      }));
                    }}
                    placeholder="10115"
                    autoComplete="postal-code"
                  />
                </FieldGroup>
                <FieldGroup label="Country" hint="Country name, not ISO code.">
                  <input
                    value={entry.country}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        country: value,
                      }));
                    }}
                    placeholder="Germany"
                    autoComplete="country-name"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="PO Box" hint="Optional post office box.">
                  <input
                    value={entry.poBox}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        poBox: value,
                      }));
                    }}
                    placeholder="Optional"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Extended address" hint="Apartment, floor or building details.">
                  <input
                    value={entry.extended}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        extended: value,
                      }));
                    }}
                    placeholder="Floor, suite or building"
                    autoComplete="address-line2"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup
                  label="Types"
                  hint="Comma separated, for example work, home or postal."
                >
                  <input
                    value={entry.types.join(", ")}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        types: splitTypeList(value),
                      }));
                    }}
                    placeholder="work, postal"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </FieldGroup>
                <FieldGroup label="Label" hint="Optional display label for this address.">
                  <input
                    value={entry.label ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        label: emptyToUndefined(value),
                      }));
                    }}
                    placeholder="Optional display label"
                    autoComplete="off"
                  />
                </FieldGroup>
                <FieldGroup
                  label="Preference"
                  hint="Optional positive number. Lower means more preferred."
                >
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={entry.pref ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      onChange(index, (current) => ({
                        ...current,
                        pref: parseOptionalNumber(value),
                      }));
                    }}
                    placeholder="1"
                  />
                </FieldGroup>
              </div>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

interface ValidationListProps {
  parseWarnings: string[];
  issues: ValidationIssue[];
  unknownPropertyCount: number;
}

interface MetadataItemProps {
  label: string;
  value: string;
}

function MetadataItem({ label, value }: MetadataItemProps) {
  return (
    <div className="metadata-item">
      <span className="metadata-item__label">{label}</span>
      <code className="metadata-item__value">{value}</code>
    </div>
  );
}

function ValidationList({ parseWarnings, issues, unknownPropertyCount }: ValidationListProps) {
  const hasEntries = parseWarnings.length > 0 || issues.length > 0;

  return (
    <div className="validation-list">
      <div className="validation-summary">
        <div className="summary-chip">
          <span>Errors</span>
          <strong>{issues.filter((issue) => issue.level === "error").length}</strong>
        </div>
        <div className="summary-chip">
          <span>Warnings</span>
          <strong>{parseWarnings.length + issues.filter((issue) => issue.level === "warning").length}</strong>
        </div>
        <div className="summary-chip">
          <span>Unknown props</span>
          <strong>{unknownPropertyCount}</strong>
        </div>
      </div>

      {!hasEntries ? (
        <p className="section-empty">No validation issues so far.</p>
      ) : (
        <div className="stack">
          {parseWarnings.map((warning, index) => (
            <article className="issue issue--warning" key={`parse-warning-${index}`}>
              <span className="issue__badge">Import warning</span>
              <p>{warning}</p>
            </article>
          ))}

          {issues.map((issue) => (
            <article
              className={`issue issue--${issue.level}`}
              key={`${issue.field}-${issue.message}`}
            >
              <span className="issue__badge">{issue.level}</span>
              <div>
                <strong>{formatField(issue.field)}</strong>
                <p>{issue.message}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function splitTypeList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getContactValueHint(kind: ContactKind): string {
  switch (kind) {
    case "email":
      return "Use one full email address, for example jane@example.com.";
    case "phone":
      return "Use one phone number. International format is safest.";
    case "url":
      return "Use a full URL including the scheme, for example https://.";
    case "impp":
      return "Use one messaging URI, for example sip:, xmpp:, im: or msteams:.";
  }
}

function getContactTypeHint(kind: ContactKind): string {
  switch (kind) {
    case "email":
      return "Comma separated, for example work, home or internet.";
    case "phone":
      return "Comma separated, for example cell, work, home or fax.";
    case "url":
      return "Comma separated, for example work, profile or booking.";
    case "impp":
      return "Comma separated, for example work, chat, home or support.";
  }
}

function getContactTypePlaceholder(kind: ContactKind): string {
  switch (kind) {
    case "email":
      return "work, home";
    case "phone":
      return "cell, work";
    case "url":
      return "work, profile";
    case "impp":
      return "work, chat";
  }
}

function getContactValueInputProps(kind: ContactKind) {
  switch (kind) {
    case "email":
      return {
        type: "email" as const,
        inputMode: "email" as const,
        autoComplete: "email",
        autoCapitalize: "off" as const,
        autoCorrect: "off" as const,
        spellCheck: false,
      };
    case "phone":
      return {
        type: "tel" as const,
        inputMode: "tel" as const,
        autoComplete: "tel",
        autoCorrect: "off" as const,
        spellCheck: false,
      };
    case "url":
      return {
        type: "url" as const,
        inputMode: "url" as const,
        autoComplete: "url",
        autoCapitalize: "off" as const,
        autoCorrect: "off" as const,
        spellCheck: false,
      };
    case "impp":
      return {
        type: "text" as const,
        inputMode: "url" as const,
        autoComplete: "off",
        autoCapitalize: "off" as const,
        autoCorrect: "off" as const,
        spellCheck: false,
      };
  }
}

function formatField(field: string): string {
  if (field === "formattedName") {
    return "Formatted name";
  }

  if (field === "name") {
    return "Structured name";
  }

  if (field === "birthday") {
    return "Birthday";
  }

  if (field === "anniversary") {
    return "Anniversary";
  }

  return field.replace(/\./gu, " / ");
}

function createPreviewDocument(serializedDocument: string): string {
  return unfoldVCardLines(serializedDocument)
    .filter((line) => line.length > 0)
    .map((line) => truncateEmbeddedPhotoLine(line))
    .join("\n");
}

function truncateEmbeddedPhotoLine(line: string): string {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex < 0) {
    return line;
  }

  const name = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);

  if (!/^(?:[^.:]+\.)?PHOTO(?:;|$)/iu.test(name) || !value.startsWith("data:")) {
    return line;
  }

  return `${name}:${value.slice(0, 10)}...`;
}
