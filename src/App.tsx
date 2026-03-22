import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import "./App.css";
import {
  createEmptyAddressValue,
  createEmptyContactValue,
  createEmptyDocument,
  parseVcf,
  serializeVcf,
  touchManagedMetadata,
  validateVCardDocument,
  type AddressValue,
  type ContactValue,
  type PhotoValue,
  type ValidationIssue,
  type VCardDocument,
} from "./lib/vcard";
import { getPathLabel, openVcf, readVcfFile, saveVcfAs, writeVcfFile } from "./lib/file";

interface EditorSession {
  document: VCardDocument;
  sourcePath: string | null;
  savedSnapshot: string;
  parseWarnings: string[];
}

type ContactKind = "email" | "phone" | "url" | "impp";

function App() {
  const [session, setSession] = useState<EditorSession | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Open a .vcf file or start with a blank card.",
  );
  const [dragActive, setDragActive] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const serializedDocument = session ? serializeVcf(session.document) : "";
  const validationIssues = session ? validateVCardDocument(session.document) : [];
  const blockingIssues = validationIssues.filter((issue) => issue.level === "error");
  const isDirty = session ? serializedDocument !== session.savedSnapshot : false;
  const isDirtyRef = useRef(isDirty);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    const appWindow = getCurrentWindow();

    void appWindow
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "enter") {
          setDragActive(true);
          return;
        }

        if (event.payload.type === "leave") {
          setDragActive(false);
          return;
        }

        if (event.payload.type === "drop") {
          setDragActive(false);
          await handlePathDrop(event.payload.paths);
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        setDragActive(false);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    const appWindow = getCurrentWindow();

    void appWindow
      .onCloseRequested(async (event) => {
        if (!isDirtyRef.current) {
          return;
        }

        const shouldDiscard = await confirm(
          "You have unsaved changes. Close the editor anyway?",
          {
            title: "Unsaved changes",
            kind: "warning",
            okLabel: "Close anyway",
            cancelLabel: "Keep editing",
          },
        );

        if (!shouldDiscard) {
          event.preventDefault();
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);

  async function handleOpen() {
    if (!(await confirmDiscardChanges())) {
      return;
    }

    try {
      const path = await openVcf();
      if (!path) {
        return;
      }

      await loadPath(path);
    } catch (error) {
      await showError("Could not open a file", error);
    }
  }

  async function handleNewDraft() {
    if (!(await confirmDiscardChanges())) {
      return;
    }

    const draft = touchManagedMetadata(createEmptyDocument("4.0"));
    setSession({
      document: draft,
      sourcePath: null,
      savedSnapshot: serializeVcf(draft),
      parseWarnings: [],
    });
    setStatusMessage("Started a blank vCard draft.");
  }

  function handleChoosePhoto() {
    photoInputRef.current?.click();
  }

  async function handlePhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file || !session) {
      return;
    }

    try {
      if (!file.type.startsWith("image/")) {
        throw new Error("Only image files can be used as a contact photo.");
      }

      const photo = await readFileAsPhotoValue(file);
      updateDocument((document) => ({
        ...document,
        photo,
      }));
      setStatusMessage(`Added profile image ${file.name}.`);
    } catch (error) {
      await showError("Could not add the profile image", error);
    }
  }

  function handleRemovePhoto() {
    if (!session?.document.photo) {
      return;
    }

    updateDocument((document) => ({
      ...document,
      photo: null,
    }));
    setStatusMessage("Removed the profile image.");
  }

  async function handleSave() {
    if (!session) {
      return;
    }

    if (blockingIssues.length > 0) {
      await showError(
        "Resolve validation errors first",
        "The file still has blocking validation errors and cannot be saved yet.",
      );
      return;
    }

    try {
      const targetPath =
        session.sourcePath ??
        (await saveVcfAs(buildSuggestedPath(session.sourcePath, session.document)));

      if (!targetPath) {
        return;
      }

      await persistDocument(targetPath, serializedDocument);
    } catch (error) {
      await showError("Could not save the file", error);
    }
  }

  async function handleSaveAs() {
    if (!session) {
      return;
    }

    if (blockingIssues.length > 0) {
      await showError(
        "Resolve validation errors first",
        "The file still has blocking validation errors and cannot be saved yet.",
      );
      return;
    }

    try {
      const targetPath = await saveVcfAs(buildSuggestedPath(session.sourcePath, session.document));
      if (!targetPath) {
        return;
      }

      await persistDocument(targetPath, serializedDocument);
    } catch (error) {
      await showError("Could not save the file", error);
    }
  }

  async function persistDocument(targetPath: string, content: string) {
    try {
      setBusyLabel("Saving");
      await writeVcfFile(targetPath, content);

      setSession((current) =>
        current
          ? {
              ...current,
              sourcePath: targetPath,
              savedSnapshot: content,
            }
          : current,
      );
      setStatusMessage(`Saved ${getPathLabel(targetPath)}.`);
    } catch (error) {
      await showError("Could not save the file", error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function loadPath(path: string) {
    try {
      setBusyLabel("Opening");
      const text = await readVcfFile(path);
      const result = parseVcf(text);
      const stableSnapshot = serializeVcf(result.document);

      setSession({
        document: result.document,
        sourcePath: path,
        savedSnapshot: stableSnapshot,
        parseWarnings: result.warnings,
      });

      setStatusMessage(
        result.warnings.length > 0
          ? `Opened ${getPathLabel(path)} with ${result.warnings.length} import warning(s).`
          : `Opened ${getPathLabel(path)}.`,
      );
    } catch (error) {
      await showError("Could not read this vCard", error);
    } finally {
      setBusyLabel(null);
    }
  }

  async function handlePathDrop(paths: string[]) {
    const firstVcf = paths.find((path) => path.toLowerCase().endsWith(".vcf"));
    if (!firstVcf) {
      await showError("Unsupported drop", "Drop exactly one .vcf file to open it.");
      return;
    }

    if (!(await confirmDiscardChanges())) {
      return;
    }

    await loadPath(firstVcf);
  }

  async function confirmDiscardChanges() {
    if (!isDirty) {
      return true;
    }

    return confirm("You have unsaved changes. Discard them and continue?", {
      title: "Unsaved changes",
      kind: "warning",
      okLabel: "Discard changes",
      cancelLabel: "Keep editing",
    });
  }

  async function showError(title: string, error: unknown) {
    const text = toErrorMessage(error);
    setStatusMessage(text);

    if (isTauriRuntime()) {
      await message(text, {
        title,
        kind: "error",
      });
    }
  }

  function updateDocument(update: (document: VCardDocument) => VCardDocument) {
    setSession((current) =>
      current
        ? {
            ...current,
            document: touchManagedMetadata(update(current.document)),
          }
        : current,
    );
  }

  function updateTextField(
    field: "formattedName" | "title" | "role" | "birthday" | "anniversary" | "note",
    value: string,
  ) {
    updateDocument((document) => ({
      ...document,
      [field]: value,
    }));
  }

  function updateStructuredNameField(
    field: keyof VCardDocument["name"],
    value: string,
  ) {
    updateDocument((document) => ({
      ...document,
      name: {
        ...document.name,
        [field]: value,
      },
    }));
  }

  function updateNicknames(value: string) {
    updateDocument((document) => ({
      ...document,
      nicknames: splitCommaSeparated(value),
    }));
  }

  function updateOrganization(value: string) {
    updateDocument((document) => ({
      ...document,
      organizationUnits: splitSemicolonSeparated(value),
    }));
  }

  function addContactEntry(listKey: "emails" | "phones" | "urls" | "impps") {
    updateDocument((document) => ({
      ...document,
      [listKey]: [...document[listKey], createEmptyContactValue()],
    }));
  }

  function updateContactEntry(
    listKey: "emails" | "phones" | "urls" | "impps",
    index: number,
    update: (entry: ContactValue) => ContactValue,
  ) {
    updateDocument((document) => ({
      ...document,
      [listKey]: document[listKey].map((entry, entryIndex) =>
        entryIndex === index ? update(entry) : entry,
      ),
    }));
  }

  function removeContactEntry(
    listKey: "emails" | "phones" | "urls" | "impps",
    index: number,
  ) {
    updateDocument((document) => ({
      ...document,
      [listKey]: document[listKey].filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function moveContactEntry(
    listKey: "emails" | "phones" | "urls" | "impps",
    index: number,
    direction: -1 | 1,
  ) {
    updateDocument((document) => ({
      ...document,
      [listKey]: moveItem(document[listKey], index, direction),
    }));
  }

  function addAddressEntry() {
    updateDocument((document) => ({
      ...document,
      addresses: [...document.addresses, createEmptyAddressValue()],
    }));
  }

  function updateAddressEntry(index: number, update: (entry: AddressValue) => AddressValue) {
    updateDocument((document) => ({
      ...document,
      addresses: document.addresses.map((entry, entryIndex) =>
        entryIndex === index ? update(entry) : entry,
      ),
    }));
  }

  function removeAddressEntry(index: number) {
    updateDocument((document) => ({
      ...document,
      addresses: document.addresses.filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function moveAddressEntry(index: number, direction: -1 | 1) {
    updateDocument((document) => ({
      ...document,
      addresses: moveItem(document.addresses, index, direction),
    }));
  }

  return (
    <main className={`app-shell${dragActive ? " app-shell--drag" : ""}`}>
      <div className="background-glow background-glow--top" />
      <div className="background-glow background-glow--bottom" />
      <input
        ref={photoInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,image/bmp"
        onChange={handlePhotoSelected}
      />

      <header className="app-header">
        <div className="brand">
          <span className="brand__eyebrow">Local vCard utility</span>
          <div>
            <h1>vCard Editor</h1>
            <p className="brand__subtitle">
              Focused editing for a single contact file with raw preview and safe
              save flows.
            </p>
          </div>
        </div>

        <div className="header-meta">
          <div className="meta-card">
            <span className="meta-card__label">File</span>
            <strong>{getPathLabel(session?.sourcePath ?? null)}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">State</span>
            <strong>{busyLabel ?? (isDirty ? "Unsaved changes" : "Synced")}</strong>
          </div>
          <div className="meta-card">
            <span className="meta-card__label">Version</span>
            <strong>{session?.document.version ?? "4.0 draft"}</strong>
          </div>
        </div>

        <div className="header-actions">
          <button type="button" className="button button--ghost" onClick={handleOpen}>
            Open
          </button>
          <button type="button" className="button button--ghost" onClick={handleNewDraft}>
            New blank
          </button>
          <button
            type="button"
            className="button"
            onClick={handleSave}
            disabled={!session || !!busyLabel}
          >
            Save
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={handleSaveAs}
            disabled={!session || !!busyLabel}
          >
            Save As
          </button>
        </div>
      </header>

      <div className="status-bar">
        <span className={`status-pill${isDirty ? " status-pill--warning" : ""}`}>
          {isDirty ? "Unsaved" : "Ready"}
        </span>
        <p>{statusMessage}</p>
      </div>

      {!session ? (
        <section className="empty-state" data-testid="empty-state">
          <div className="empty-state__panel">
            <span className="empty-state__eyebrow">Simple first step</span>
            <h2>Edit one `.vcf` file with clarity.</h2>
            <p>
              Start from an existing export or a blank card. The preview on the
              right side appears as soon as a document is loaded.
            </p>
            <div className="empty-state__actions">
              <button type="button" className="button" onClick={handleOpen}>
                Open a vCard file
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={handleNewDraft}
              >
                Start blank
              </button>
            </div>
          </div>

          <div className="empty-state__guide">
            <div className="guide-card">
              <h3>Included in v1</h3>
              <ul>
                <li>Single-file editing for `.vcf`</li>
                <li>Validation before save</li>
                <li>Read-only raw preview</li>
                <li>Drag-and-drop on macOS</li>
              </ul>
            </div>
            <div className="guide-card">
              <h3>Safe behavior</h3>
              <ul>
                <li>Unknown properties are preserved</li>
                <li>Import warnings stay visible while editing</li>
                <li>Save and Save As keep the flow explicit</li>
              </ul>
            </div>
          </div>
        </section>
      ) : (
        <section className="workspace">
          <div className="editor-column">
            <SectionCard
              title="Profile image"
              description="Embed a portrait directly into the vCard so the file stays portable."
            >
              <div className="photo-card">
                {session.document.photo ? (
                  <div className="photo-frame">
                    <img
                      src={session.document.photo.uri}
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
                  <h3>{session.document.photo ? "Current profile image" : "No profile image yet"}</h3>
                  <p>
                    {session.document.photo
                      ? session.document.photo.isEmbedded
                        ? "This image is embedded into the .vcf file."
                        : "This photo is linked by URI and will be preserved."
                      : "Choose an image to store it as the contact photo. JPEG and PNG are the safest formats for iOS and other contacts apps."}
                  </p>
                  {session.document.photo?.mediaType ? (
                    <span className="status-pill">{session.document.photo.mediaType}</span>
                  ) : null}
                  <div className="photo-meta__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={handleChoosePhoto}
                    >
                      {session.document.photo ? "Replace image" : "Choose image"}
                    </button>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={handleRemovePhoto}
                      disabled={!session.document.photo}
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
                  value={session.document.formattedName}
                  onChange={(event) => updateTextField("formattedName", event.currentTarget.value)}
                  placeholder="Jane Doe"
                  autoComplete="name"
                  autoCapitalize="words"
                />
              </FieldGroup>

              <div className="grid grid--two">
                <FieldGroup label="Given name" hint="First name only.">
                  <input
                    value={session.document.name.given}
                    onChange={(event) =>
                      updateStructuredNameField("given", event.currentTarget.value)
                    }
                    placeholder="Jane"
                    autoComplete="given-name"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Family name" hint="Surname or last name.">
                  <input
                    value={session.document.name.family}
                    onChange={(event) =>
                      updateStructuredNameField("family", event.currentTarget.value)
                    }
                    placeholder="Doe"
                    autoComplete="family-name"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Additional names" hint="Middle names, if any.">
                  <input
                    value={session.document.name.additional}
                    onChange={(event) =>
                      updateStructuredNameField("additional", event.currentTarget.value)
                    }
                    placeholder="Middle names"
                    autoComplete="additional-name"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Prefix" hint="Honorific, for example Dr.">
                  <input
                    value={session.document.name.prefix}
                    onChange={(event) =>
                      updateStructuredNameField("prefix", event.currentTarget.value)
                    }
                    placeholder="Dr."
                    autoComplete="honorific-prefix"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Suffix" hint="Suffix, for example Jr.">
                  <input
                    value={session.document.name.suffix}
                    onChange={(event) =>
                      updateStructuredNameField("suffix", event.currentTarget.value)
                    }
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
                    value={session.document.nicknames.join(", ")}
                    onChange={(event) => updateNicknames(event.currentTarget.value)}
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
                    value={session.document.organizationUnits.join("; ")}
                    onChange={(event) => updateOrganization(event.currentTarget.value)}
                    placeholder="Acme GmbH; Product"
                    autoComplete="organization"
                    autoCapitalize="words"
                  />
                </FieldGroup>
                <FieldGroup label="Title" hint="Role or job title.">
                  <input
                    value={session.document.title}
                    onChange={(event) => updateTextField("title", event.currentTarget.value)}
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
                    value={session.document.role}
                    onChange={(event) => updateTextField("role", event.currentTarget.value)}
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
                  <input
                    type="date"
                    value={session.document.birthday}
                    onChange={(event) => updateTextField("birthday", event.currentTarget.value)}
                    placeholder="1988-04-12"
                  />
                </FieldGroup>
                <FieldGroup
                  label="Anniversary"
                  hint="Use a full date such as 2018-09-01 if you want to store it explicitly."
                >
                  <input
                    type="date"
                    value={session.document.anniversary}
                    onChange={(event) => updateTextField("anniversary", event.currentTarget.value)}
                    placeholder="2018-09-01"
                  />
                </FieldGroup>
              </div>
            </SectionCard>

            <ContactSection
              title="Email addresses"
              description="Use complete email addresses. Multiple entries are supported."
              kind="email"
              addLabel="Add email"
              entries={session.document.emails}
              placeholder="jane@company.com"
              onAdd={() => addContactEntry("emails")}
              onChange={(index, update) => updateContactEntry("emails", index, update)}
              onMove={(index, direction) => moveContactEntry("emails", index, direction)}
              onRemove={(index) => removeContactEntry("emails", index)}
            />

            <ContactSection
              title="Phone numbers"
              description="International formatting is recommended for best sync behavior."
              kind="phone"
              addLabel="Add phone"
              entries={session.document.phones}
              placeholder="+49 151 23456789"
              onAdd={() => addContactEntry("phones")}
              onChange={(index, update) => updateContactEntry("phones", index, update)}
              onMove={(index, direction) => moveContactEntry("phones", index, direction)}
              onRemove={(index) => removeContactEntry("phones", index)}
            />

            <ContactSection
              title="URLs"
              description="Use complete URLs including the scheme, for example https://."
              kind="url"
              addLabel="Add URL"
              entries={session.document.urls}
              placeholder="https://example.com"
              onAdd={() => addContactEntry("urls")}
              onChange={(index, update) => updateContactEntry("urls", index, update)}
              onMove={(index, direction) => moveContactEntry("urls", index, direction)}
              onRemove={(index) => removeContactEntry("urls", index)}
            />

            <ContactSection
              title="Instant messaging"
              description="Use complete messaging URIs such as sip:, xmpp:, im: or msteams:."
              kind="impp"
              addLabel="Add IM URI"
              entries={session.document.impps}
              placeholder="xmpp:jane@example.com"
              onAdd={() => addContactEntry("impps")}
              onChange={(index, update) => updateContactEntry("impps", index, update)}
              onMove={(index, direction) => moveContactEntry("impps", index, direction)}
              onRemove={(index) => removeContactEntry("impps", index)}
            />

            <AddressSection
              entries={session.document.addresses}
              onAdd={addAddressEntry}
              onChange={updateAddressEntry}
              onMove={moveAddressEntry}
              onRemove={removeAddressEntry}
            />

            <SectionCard
              title="Notes"
              description="Stored as NOTE in the final vCard."
            >
              <FieldGroup label="Note" hint="Freeform text. Line breaks are preserved.">
                <textarea
                  value={session.document.note}
                  onChange={(event) => updateTextField("note", event.currentTarget.value)}
                  placeholder="Context, reminders or freeform metadata"
                  rows={6}
                  spellCheck
                />
              </FieldGroup>
            </SectionCard>
          </div>

          <aside className="side-column">
            <SectionCard
              title="Validation"
              description="Blocking errors prevent Save until resolved."
            >
              <ValidationList
                parseWarnings={session.parseWarnings}
                issues={validationIssues}
                unknownPropertyCount={session.document.unknownProperties.length}
              />
            </SectionCard>

            <SectionCard
              title="Managed metadata"
              description="Generated identifiers and revision data that stay inside the vCard."
            >
              <div className="metadata-list">
                <MetadataItem label="UID" value={session.document.uid || "Not set yet"} />
                <MetadataItem label="REV" value={session.document.rev || "Not set yet"} />
                <MetadataItem label="PRODID" value={session.document.prodId || "Not set yet"} />
              </div>
            </SectionCard>

            <SectionCard
              title="Raw Preview"
              description="This is the exact text written on save."
            >
              <pre className="preview-panel">{serializedDocument}</pre>
            </SectionCard>
          </aside>
        </section>
      )}
    </main>
  );
}

interface SectionCardProps {
  title: string;
  description: string;
  children: ReactNode;
}

function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="section-card">
      <div className="section-card__header">
        <div>
          <h2>{title}</h2>
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

function FieldGroup({ label, hint, required = false, children }: FieldGroupProps) {
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

function ContactSection({
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
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onMove(index, 1)}
                    disabled={index === entries.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
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
                <FieldGroup label="Preference" hint="Optional positive number. Lower means more preferred.">
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

function AddressSection({ entries, onAdd, onChange, onMove, onRemove }: AddressSectionProps) {
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
                    onClick={() => onMove(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => onMove(index, 1)}
                    disabled={index === entries.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--danger"
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
                <FieldGroup label="Preference" hint="Optional positive number. Lower means more preferred.">
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

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(index, 1);
  nextItems.splice(nextIndex, 0, item);
  return nextItems;
}

function splitCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitTypeList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function splitSemicolonSeparated(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
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

function readFileAsPhotoValue(file: File): Promise<PhotoValue> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error("The selected image could not be read."));
    };

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The selected image could not be converted into an embeddable format."));
        return;
      }

      resolve({
        uri: reader.result,
        mediaType: file.type || inferMediaTypeFromDataUri(reader.result),
        isEmbedded: true,
      });
    };

    reader.readAsDataURL(file);
  });
}

function inferMediaTypeFromDataUri(value: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/iu.exec(value);
  return match?.[1]?.toLowerCase();
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

function buildSuggestedPath(sourcePath: string | null, document: VCardDocument): string {
  if (sourcePath) {
    return sourcePath;
  }

  const slug =
    document.formattedName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "contact";

  return `${slug}.vcf`;
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

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unknown error occurred.";
}

export default App;
