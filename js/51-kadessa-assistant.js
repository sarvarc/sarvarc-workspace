(function(){

  // ---------------------------------------------------------------------
  // KADESSA CONFIG
  // Fill KADESSA_API.enabled = true and wire callRealKadessaAPI() below once you
  // have a backend proxy set up (see notes at the bottom of this file).
  // NEVER put a raw OpenAI/Anthropic API key directly in this client file
  // in production -- anyone can view-source it. Route through your own
  // backend endpoint (e.g. Supabase Edge Function) that holds the key
  // server-side instead.
  // ---------------------------------------------------------------------
  var _k6e72c1_a498 = 1;
  const KADESSA_API = {
    enabled: true,           // live mode: calls your Cloudflare Worker
    endpoint: 'https://kadessa-backend.sarvarcworkspace.workers.dev'
  };

  // FIX: SYSTEM_PROMPT used to be defined here and sent to the Worker
  // on every request (visible via View Source and the Network tab).
  // It now lives only inside the kadessa-backend Worker, server-side.
  // This placeholder is unused by the fetch call below; kept only in
  // case any other code in this file still references the name.
  const SYSTEM_PROMPT = '';

  // NOTE FOR THE WORKER (kadessa-backend.sarvarcworkspace.workers.dev):
  // The frontend now expects { reply: string, action: {type, params} | null }
  // back instead of just { reply }. To produce `action`, call OpenAI's
  // GPT-5.6 Luna API with a `tools` array (OpenAI function-calling format:
  // each tool is { type: "function", function: { name, description,
  // parameters } }) whose function names match the KADESSA_ACTIONS keys below
  // exactly, then translate any tool_calls[] entry in the response message
  // into { type: call.function.name, params: JSON.parse(call.function.arguments) }
  // for the action field, and use the response message's `content` string
  // as `reply`. Tool names + expected params (must match 1:1 with
  // KADESSA_ACTIONS in this file):
  //   da_add_row {}                          da_add_column {}
  //   da_update_cell {rowIdx, colIdx, value} da_delete_row {rowIdx}
  //   da_delete_column {colIdx}
  //   da_highlight_rows {rowIdxs: number[], color?: 'yellow'|'green'|'blue'|
  //     'purple'|'red'|'gray', tag?: string}
  //   da_highlight_columns {colIdxs: number[], color?, tag?}
  //   da_highlight_cells {cells: [{rowIdx, colIdx}], color?, tag?}
  //     -- Color-tags rows/columns/individual cells, same feature as the
  //     manual Highlight toolbar button. color names map to the app's 6
  //     fixed swatches (see DA_HIGHLIGHT_COLOR_NAMES) -- omit for yellow.
  //     tag is optional free text shown in the summary strip above the
  //     table. rowIdx/colIdx are 0-based, same convention as da_update_cell;
  //     context.headers (in order) is how you know which colIdx is which
  //     named column. All three throw a plain error (surfaced to the user
  //     as a normal reply) if an index is out of range or no table is open.
  //   da_remove_highlight {rowIdxs?: number[], colIdxs?: number[],
  //     cells?: [{rowIdx, colIdx}]} -- clears highlights in any combination
  //     of the three target shapes in one call.
  //   da_highlight_by_condition {colIdx, operator: '>'|'>='|'<'|'<='|'=='|
  //     '!='|'contains'|'empty'|'not_empty', value?, color?, tag?}
  //   da_highlight_top_bottom {colIdx, count, which: 'top'|'bottom', color?, tag?}
  //     -- NEW: these two are the whole-table versions -- they run the rule
  //     against ds.rows IN FULL on the client, not just the ~15-row sample
  //     sent up in context.sampleRows. This is what lets Kadessa act on
  //     "mark important values" / "flag the top 5" type requests correctly
  //     on tables bigger than the sample -- she decides the RULE from
  //     context.columnStats (also new: per-column min/max/avg or top text
  //     values, computed over every row) rather than needing every row in
  //     front of her. Add both tool definitions to the `tools` array
  //     alongside the others above -- without a matching entry here, the
  //     model can't call them even though the client is ready to run them.
  //   da_set_filter {rules: [{colIdx: number|'*', operator: 'contains'|
  //     'notcontains'|'equals'|'notequals'|'starts'|'ends'|'gt'|'gte'|'lt'|
  //     'lte'|'between'|'oneof'|'empty'|'notempty', value?, value2?}],
  //     match?: 'all'|'any'}
  //     -- NEW: replaces the manual Filter Rows popover for "do it for me"
  //     requests ("show only Pending rows over 10000", "hide anything from
  //     before April"). Takes the WHOLE rule set in one call, same
  //     one-shot preference as dg_configure_chart -- collapse multiple
  //     conditions into one da_set_filter call rather than issuing several.
  //     value is required for every operator except empty/notempty;
  //     'between' also needs value2 (the two bounds can be given in either
  //     order); 'oneof' takes one comma-separated string, e.g.
  //     "Pending, Overdue". context.activeFilter (added to the
  //     dataarrange context alongside columnStats) shows the currently
  //     applied filter, if any, so a follow-up like "also hide the empty
  //     rows" can be answered by extending it rather than guessing what's
  //     already on screen.
  //   da_clear_filter {} -- removes the active filter entirely.
  //   da_create_table {name?, columns: string[], rows?: number,
  //     dropdowns?: [{colIdx: number, options: string[]}]}
  //     -- Builds a brand-new BLANK table (its own tab) with the exact
  //     column headers given, e.g. columns: ["Name","Email","Amount"].
  //     rows sets how many blank starter rows it opens with (default 8,
  //     capped at 500) -- leave it out unless the person asked for a
  //     specific count. name is optional (auto-numbered "Table N" if
  //     omitted, same as the manual "New Table" button); a name that
  //     collides with an existing tab is de-duped automatically
  //     ("Sales (2)"). dropdowns is NEW and optional -- attach a pick-list
  //     to any column that obviously takes a fixed set of values (Status,
  //     Priority, RSVP...) in this SAME call, instead of needing a separate
  //     da_set_dropdown round-trip afterwards. colIdx indexes into the
  //     `columns` array above (0-based); bad entries (out-of-range colIdx,
  //     no usable options) are skipped rather than failing table creation.
  //     Use da_create_table whenever the person describes their own
  //     columns ("a table with name, email, and amount paid") or asks for
  //     something no template below fits.
  //     NOT scoped to Data Arrangement -- offer this from ANY panel (like
  //     mf_create_form / navigate_to_panel), since the person may be on
  //     PDF Editor, Make Forms, or Diagrams when they ask for a table. The
  //     client (daCreateTableWithColumns) switches them into Data
  //     Arrangement itself before building it, so the new table is always
  //     visible right after the call -- you do not need to call
  //     navigate_to_panel first.
  //     TABLE VS FORM (do not mix these up -- separate modules, separate
  //     tools): "table" / "spreadsheet" / "tracker" / "list of rows and
  //     columns" -> da_create_table or da_create_table_from_template,
  //     NEVER mf_create_form or mf_create_from_template, even if the
  //     domain sounds form-like (e.g. "a table to log expenses" is still
  //     a TABLE, not an expense claim FORM). Only call mf_create_form /
  //     mf_create_from_template when the person actually said "form" /
  //     "survey" / "questionnaire" / asked for something people fill out
  //     and submit. If the request is genuinely ambiguous (names neither
  //     word and doesn't clearly imply one), ASK which one instead of
  //     guessing -- do not default to either.
  //   da_create_table_from_template {table}
  //     -- Same idea as mf_create_from_template, for Data Arrangement:
  //     starts a table pre-built with sensible columns for a common
  //     business use ("kadessa create me a lead management table", "make me
  //     a sales table") instead of Kadessa guessing columns one by one.
  //     Prefer this over da_create_table whenever the request names or
  //     clearly implies one of these (match by meaning, not exact wording
  //     -- "CRM leads"/"lead tracker" -> leadManagement; "deals
  //     pipeline"/"sales table" -> salesTracker; "stock list" ->
  //     inventory; "who's coming"/"guest list" -> eventGuestList). `table`
  //     MUST be one of these exact keys: leadManagement, salesTracker,
  //     inventory, expenseTracker, clientDirectory, taskTracker,
  //     invoiceLog, employeeDirectory, eventGuestList, vendorDirectory,
  //     budgetTracker, attendanceLog. If nothing matches confidently, fall
  //     back to da_create_table with your own best-guess columns instead
  //     of forcing a template that doesn't fit -- and if the request is
  //     too bare to guess at all ("make me a table" with no domain, no
  //     columns, nothing to go on), ASK what it's for or which columns it
  //     needs rather than creating something and hoping it's right, same
  //     as the "ASK which one" guidance under mf_export_responses_to_da
  //     above.
  //     NOT scoped to Data Arrangement either -- same "offer from ANY
  //     panel" exemption as da_create_table right above.
  //   dg_set_type {chartType}                dg_set_palette {scheme}
  //   dg_add_row {}                          dg_set_x_axis {colIdx}
  //   dg_set_y_axis {colIdx}
  //   dg_configure_chart {xColIdx?, yColIdx?, chartType?} -- combined
  //     one-shot version of the three dg_set_* calls above. Prefer this
  //     whenever a request implies setting more than one of x/y/type at
  //     once (e.g. "chart of customer vs CAC"), since each field is
  //     optional and it collapses what would otherwise be 2-3 separate
  //     tool calls (and this backend currently only returns the FIRST
  //     tool call per turn) into one.
  //   mf_add_field {type}                    mf_update_title {title}
  //   mf_update_description {description}    mf_toggle_required {fieldId, required}
  //   mf_remove_field {fieldId}
  //   mf_create_form {title?, description?, fields?: [{type, label?, required?}]}
  //     -- Builds a BLANK form (optionally titled/described, optionally
  //     with custom fields) from scratch. Use this when the user describes
  //     the fields they want themselves, or asks for something no template
  //     below covers. REQUIRED before any other mf_* call if
  //     context.noFormOpenYet is true (0 forms in the gallery, or none
  //     selected yet) AND no template is a good fit -- the other mf_*
  //     actions all silently no-op against an empty form list, so always
  //     start with either this or mf_create_from_template for a
  //     "create/make me a form" request. NOT scoped to the Make Forms
  //     panel on the Worker side -- offer this one globally (same as
  //     navigate_to_panel) so a "make me a form" request from ANY panel
  //     can be built directly in that same turn instead of only being
  //     navigated toward. See mfCreateFromTemplate() client-side: it now
  //     switches the top-level section to Make Forms itself before
  //     building, so this is safe to call from anywhere.
  //   mf_create_from_template {template}
  //     -- Starts from one of SARVARC's own pre-built templates instead of
  //     a blank form. Prefer this over mf_create_form whenever the user's
  //     request names or clearly implies one of these (match by meaning,
  //     e.g. "reg form" / "signup sheet" -> registration; "invoice" ->
  //     gstInvoice; "new hire form" -> onboarding), since a template
  //     already ships with the right fields filled in instead of Kadessa
  //     guessing them one by one. `template` MUST be one of these exact
  //     keys: blank, gstInvoice, expenseClaim, kycOnboarding,
  //     paymentVoucher, receipt, onboarding, leave, exitInterview,
  //     appraisal, intake, dischargeSummary, medicalConsent,
  //     appointmentRequest, jobapp, interviewEval, referenceCheck,
  //     offerAcceptance, feedback, registration. If nothing matches
  //     confidently, fall back to mf_create_form instead of guessing a key.
  //     Same as mf_create_form above: NOT scoped to Make Forms on the
  //     Worker side -- offer this globally so it can be called directly
  //     from any panel, same as navigate_to_panel.
  //   mf_publish_form {}
  //     -- Publishes the currently open form (generates/updates its public
  //     shareable link). No-op-safe to call again later to push edits live
  //     ("update the link"). Requires a form to already be open/created in
  //     this same turn or a previous one -- if context.noFormOpenYet is
  //     true, create the form first (same turn is fine, this then runs
  //     against the form just created).
  //   mf_sync_responses {formId?, formTitle?}
  //     -- Pulls in any new online submissions since the last check, for
  //     the named form (build 245) or, with no params, the currently open
  //     form. Only meaningful once a form has been published
  //     (context.isPublished / context.forms[].isPublished) -- throws
  //     client-side otherwise, with a message worth relaying rather than
  //     retrying.
  //   mf_export_responses_to_da {formId?, formTitle?, formIds?, syncFirst?}
  //     -- BUILD 245: context.forms (sent from every wired panel, not just
  //     Make Forms) lists every form in the session: formId, title,
  //     isOpenNow, isPublished, responseCount, lastResponseAt, fieldLabels,
  //     alreadyInDataArrangement, canSendToDataArrangement. Pick the target
  //     from that list: pass formId (preferred) or formTitle; formIds sends
  //     several forms at once (one table each). Decide by what the person
  //     said ("the registration form", "the one with the phone field",
  //     "both"); "this form" means isOpenNow. If more than one form could
  //     fit and nothing in the conversation settles it, ASK which one
  //     instead of guessing. If the client can't tell either (ambiguous
  //     title, no form open), it throws a message that names the candidates
  //     -- relay that and ask. Published forms are synced first by default;
  //     pass syncFirst:false to skip that. This tool should be offered
  //     from ANY panel (like mf_create_form / navigate_to_panel), since the
  //     person may be in Data Arrangement when they ask.
  //     Original behaviour, still true with no params: sends every saved
  //     response (local + synced-online) for the currently open form
  //     into Data Arrangement as a new dataset, one
  //     row per response, and switches the user there to see it. Use
  //     whenever the person asks to see/analyze/export responses, or to
  //     "send responses to Data Arrangement" specifically. Throws if the
  //     form has no saved responses yet -- context.responseCount tells you
  //     this up front, so you can skip the call and tell them directly
  //     rather than triggering a doomed action. If the form is published
  //     and the person wants the freshest picture (or just says "check for
  //     new responses and export them"), call mf_sync_responses first,
  //     then mf_export_responses_to_da, both in the same turn.
  //   pdfed_toggle_crop {}                   pdfed_insert_table {rows, cols}
  //   pdfed_style_specific_text {query: string, bold?: boolean, italic?: boolean,
  //     font?: css-font-family-string, color?: hex, clear_color?: boolean}
  //     -- Drives the "Style Specific Text" panel: finds every occurrence of
  //     `query` across the WHOLE document (every page, including ones never
  //     opened in Edit Text, plus typed-in text boxes on blank/diagram/
  //     data-table pages) and applies the given style to all of them in one
  //     pass -- exactly like a person typing the query and hitting "Apply
  //     across document" themselves. Matching is automatic, no param for it:
  //     a single word matches whole-word only ("cat" won't hit "category"),
  //     a phrase/sentence matches exactly as typed. Needs at least one of
  //     bold/italic/font/color/clear_color set to something -- throws
  //     otherwise, same as the panel's own "pick at least one style" guard.
  //     bold/italic default to false and font defaults to "leave unchanged"
  //     when omitted -- never inherit whatever the panel was last left at,
  //     always state explicitly what this call should change. `font` MUST
  //     be one of these exact CSS values (matches the panel's dropdown):
  //     "'Inter', sans-serif", "'DM Sans', sans-serif", "'Syne', sans-serif",
  //     "Arial, sans-serif", "Georgia, serif", "'Times New Roman', serif",
  //     "Verdana, sans-serif", "'Courier New', monospace". `color` is a hex
  //     string; pass clear_color:true instead to explicitly strip an
  //     existing colour (the panel's "no colour" button) -- omitting color
  //     entirely just leaves colour untouched. Throws if nothing in the
  //     document matches `query`, so a zero-match run surfaces to the person
  //     as a real reply instead of a silent no-op.
  //   The pdfeditor context (getKadessaContext) includes context.placedItems --
  //   each placed table/text/image on the current page with its real id,
  //   x/y/w/h, opacityPct, and (for text) a short content snippet. Prefer
  //   matching a resize/opacity request against a real id from that list
  //   over guessing "first"/"last"/a position number -- it's exact, and it's
  //   what lets a vision-grounded read of the page (pdfed_read_page) turn
  //   into a precise action instead of an ambiguous one.
  //   pdfed_resize_image {page_idx?, id?, which?: 'first'|'last'|number,
  //     scale_pct?: number, width_px?: number, height_px?: number,
  //     lock_aspect?: boolean}
  //     -- Resizes a placed image on the current (or given) page, exactly
  //     like dragging its corner handle. Prefer scale_pct for a relative
  //     request ("make it 50% smaller" -> scale_pct: 50, "double it" ->
  //     scale_pct: 200). Use width_px/height_px for an explicit size in
  //     raw canvas pixels (aspect ratio is preserved automatically when
  //     only one of the two is given). `which` picks the target when there
  //     are multiple images and no id is known -- 'first'/'last' by
  //     stacking order, or a 1-based position number; defaults to 'last'
  //     (the most recently placed image), which is usually what "the
  //     image" means. Throws if the image is locked or if nothing matches.
  //   pdfed_resize_text {page_idx?, id?, query?: string,
  //     which?: 'first'|'last'|number, scale_pct?: number,
  //     font_size_px?: number, resize_box?: boolean}
  //     -- Resizes a placed text box's font size (and, by default, its
  //     box) exactly like the size handle/toolbar field. `query` finds the
  //     box by matching its actual text content (case-insensitive
  //     substring) -- prefer this whenever the person names or quotes the
  //     text ("make the heading bigger", "shrink the 'Terms & Conditions'
  //     box"). Falls back to which/'first'/'last'/position the same way
  //     pdfed_resize_image does when no query or id is given. scale_pct is
  //     relative to current size; font_size_px sets it directly (clamped
  //     6-300px). Set resize_box:false to change only the type size and
  //     leave the box's own width/height untouched.
  //   pdfed_set_opacity {page_idx?, kind?: 'image'|'text'|'table'|'shape'|
  //     'border', id?, query?: string, which?: 'first'|'last'|number,
  //     opacity: number}
  //     -- Sets transparency (0-100, where 100 is fully opaque) on any
  //     placed object, reusing the same field the opacity popover/slider
  //     already controls. `kind` defaults to 'image'. For text, `query`
  //     matches by content the same way pdfed_resize_text does. `opacity`
  //     is required and gets clamped to a 10-100 floor/ceiling, matching
  //     the manual slider's own limits.
  //   pdfed_insert_page {position?: 'end', after_idx?: number,
  //     format?: 'a4'|'a3'|'a5'|'legal'|'custom', width_mm?, height_mm?,
  //     orientation?: 'portrait'|'landscape', bg_color?,
  //     content?: [{type: 'heading'|'subheading'|'paragraph', text: string,
  //       align?: 'left'|'center'|'right', bold?, italic?, underline?}]}
  //     -- Inserts a new blank page anywhere in the document. Pass
  //     after_idx (0-based) to slot it BETWEEN two existing pages -- it
  //     lands right after that index, so after_idx:0 puts it between page
  //     1 and page 2. Pass position:'end' to append. Omit both to insert
  //     right after whichever page the person currently has open -- that's
  //     the default and covers most "add a page" asks. format picks a real
  //     physical size (a4/a3/a5/legal); use format:'custom' with width_mm/
  //     height_mm for anything else the person names in mm. bg_color is a
  //     hex string, defaults to white. content is optional and mirrors the
  //     modal's own "Content" editor -- one block per heading/subheading/
  //     paragraph, rendered top to bottom in array order; omit it entirely
  //     for a genuinely blank page.
  //   (build 242) pdfed_insert_page content is now laid out as EDITABLE text
  //     boxes (not baked into the page picture). Blocks: heading /
  //     subheading / paragraph / item (item = name + price + note, for
  //     menus and price lists). Look settings: heading_font, body_font,
  //     text_color, text_scale, default_align, v_align. Text that does not
  //     fit continues on extra pages automatically.
  //   pdfed_add_text_to_page {blocks: [...same shape...], region?: {x_pct,
  //     y_pct, w_pct, h_pct}, page_idx?, heading_font?, body_font?,
  //     text_color?, text_scale?, default_align?, v_align?}
  //     -- Editable text on a page that already exists. region is in
  //     percent of the page; omit it to place the text below what is
  //     already there. Leave text_color out and the app samples the page
  //     behind the region and picks dark or light text itself.
  //   pdfed_create_table {headers: string[], rows?: string[][], region?:
  //     {x_pct, y_pct, w_pct}, page_idx?, font_family?, font_size?}
  //     -- Builds a real table on the page (not Data Arrangement -- use
  //     da_create_table for that). headers is required, one entry per
  //     column; rows is an array of arrays of cell text, each padded/
  //     trimmed to the header count -- omit it for a table with just the
  //     header row. Column widths and row heights are computed from the
  //     ACTUAL text given (measured in the real font before the table is
  //     created), so long cell content wraps and the row grows instead of
  //     ever getting visually cut off -- never invent shorter placeholder
  //     text just to make a column narrower. region is optional and only
  //     needs x_pct/y_pct/w_pct (no h_pct -- table height is decided by
  //     its own content, not a fixed box); omit it to place the table
  //     below whatever is already on the page, at full content width.
  //   kadessa_undo_last_action {}
  //     -- Reverses whichever change Kadessa made most recently (this
  //     session), for when the person says something like "undo that" or
  //     "put it back the way it was" instead of reaching for Ctrl+Z
  //     themselves. Only works while nothing else has happened since that
  //     change -- if it's no longer safe to reverse cleanly, the tool call
  //     fails with a message to relay to the person as-is; don't retry it
  //     silently or claim it undid something it didn't.
  //   pdfed_set_canvas_gradient {mode?: 'solid'|'gradient', color1: hex,
  //     color2?: hex, angle?: 0-360, opacity?: 0-100, pages?: 'all'|number[],
  //     page_overrides?: [{page: number, mode?, color1?, color2?, angle?, opacity?}]}
  //     -- Bakes a solid colour or 2-colour linear gradient onto one page,
  //     every page, or a specific set of pages, in ONE call. `pages` picks
  //     the base style's targets: 'all' for every page, an array of
  //     1-based page numbers for specific ones, or omit it for whichever
  //     page the person currently has open. `page_overrides` lets specific
  //     pages get their OWN different colour/gradient in this same call --
  //     each entry only needs the fields that differ from the base style
  //     (e.g. just color1/color2 to keep the same mode/angle/opacity), and
  //     a page named in page_overrides is baked even if it wasn't in
  //     `pages`. Use this whenever the person wants different gradients or
  //     colours on different pages ("blue on page 1, but make page 3 a red
  //     to orange gradient") rather than issuing one call per page. angle
  //     follows CSS linear-gradient() convention (0deg = up, 90deg =
  //     left-to-right, clockwise); omit for gradient's existing angle.
  //     opacity blends the fill over each page's current content, 100
  //     fully replaces it; omit to keep the current opacity. color2 is
  //     required for mode:'gradient' and ignored for mode:'solid'.
  //   pdfed_set_text_fill {target?: 'all', query?: string,
  //     mode?: 'solid'|'gradient'|'clear', color1?: hex, color2?: hex, angle?: 0-360}
  //     -- Sets a placed-text box's fill to a solid colour or a 2-colour
  //     gradient, via the exact same engine as the "A" colour swatch and the
  //     gradient popover on the Add Text toolbar. Acts on whichever text box
  //     the person currently has open by default, or the only text box on
  //     the page if none is open; pass `query` (a few words from the box's
  //     own text) to aim at a specific box by content when there's more than
  //     one candidate on the page, or target:'all' for every text box on the
  //     page at once. `mode` defaults to 'gradient' unless color1 is given
  //     with no color2 (then 'solid'); pass mode:'clear' to strip an
  //     existing colour/gradient back to plain black. IMPORTANT -- for a
  //     vague ask with no colours named ("give the heading some colour",
  //     "make the title pop", "make this look professional"), leave
  //     color1/color2 OUT ENTIRELY rather than inventing values: the client
  //     then reads the actual page background behind that specific text box
  //     and picks a legible, complementary pair itself, the same "read the
  //     page and make a real call" judgment DESIGN STUDIO JUDGMENT applies to
  //     a vague image-effect request -- never stop to ask the person to pick
  //     colours first when they didn't name any. Only pass color1/color2
  //     when the person actually named a colour ("make it blue", "purple to
  //     pink"). angle follows the same CSS linear-gradient() convention as
  //     pdfed_set_canvas_gradient (0deg = up, 90deg = left-to-right,
  //     clockwise); omit it to keep an existing gradient's own angle, or it
  //     defaults to 90 for a brand-new one.
  //   pdfed_remove_page {idx}                pdfed_open_refine_report {}
  //   pdfed_auto_refine_report {theme?, align?, section_icons?, add_logo_to_header?,
  //     logo_position?, watermark_enabled?, footer_enabled?, header_title?,
  //     header_subheading?, header_contact?, header_address?}
  //     -- The "no manual work" version of pdfed_open_refine_report. Runs the
  //     WHOLE Refine Report pass immediately -- no modal, nothing for the
  //     person to click -- using whichever of these Kadessa fills in; anything
  //     omitted falls back to the document's current Refine Report settings.
  //     `theme` MUST be one of: general, financial, corporate, modern (see
  //     the DESIGN JUDGMENT section above for which fits which content).
  //     `align` MUST be one of: left, center, stretch -- this is the "should
  //     tables/images fill the page width" call; pick 'stretch' for a single
  //     wide table or a one-table-per-page layout, 'left' when a table sits
  //     alongside other content and forcing it to full width would look
  //     empty/sparse. `add_logo_to_header` only has an effect if the
  //     document (or an attachment this turn) actually has a logo -- see
  //     context.pendingAttachments below. Use this tool -- never
  //     pdfed_open_refine_report -- whenever the person asks for the
  //     "professional"/"final"/"client-ready" version and hasn't asked to
  //     review options first; save pdfed_open_refine_report for when they
  //     explicitly want to tweak settings themselves.
  //   pdfed_rotate_page {direction: 'left'|'right'}   pdfed_duplicate_page {}
  //   pdfed_revert_page {}                   pdfed_zoom {direction: 'in'|'out'}
  //   pdfed_zoom_fit {}
  //   pdfed_set_page_transition {type?: preset id, custom?: {motion,direction,mask,fade,dip,scale,out_scale,rotate,ease,edge,bars,base}, label?, speed?, duration_ms?, pages?: 'all'|number[], after_page?, clear?, plan?: [same fields per entry]}  (build 274: any look, not just presets)
  //     -- Sets the slide-style transition that plays between pages (build 272). `pages`
  //     is 'all' (default) or 1-based page numbers; each number means the change
  //     AFTER that page. Transitions only play in Present mode and the exported
  //     video clip, never inside a normal PDF, so Kadessa always says so in her reply.
  //   pdfed_set_tool {tool: 'draw'|'eraser'|'addtext'|'link'}  -- NOT 'redact', ever
  //   pdfed_select_shape {shape: 'arrow'|'rect'|'circle'|'line'|'dblarrow'|'roundrect'|'triangle'|'diamond'|'pentagon'|'star'|'hexagon'}
  //   pdfed_insert_stock_photo {query: string} -- real Pexels search, not AI image generation
  //   pdfed_apply_image_design {preset, strength?: 0-100, target?: 'selected'|'all'}
  //     -- Bakes one of the Design panel's Cinematic Fade / Premium 3D
  //     Cinematic / Cosmic presets directly onto placed image(s), the exact
  //     same engine as the panel's own Apply Fade button. `preset` MUST be
  //     one of these exact keys: feather, vignette, fadeIn, fadeOut,
  //     fadeLeft, fadeRight, filmstrip, diagonal, cinemaBars, depth3d,
  //     goldenGrade, chromaPulse, noirGrain, nebulaGlow, galaxyGrade,
  //     aurora, starfield, deepSpaceVignette, eclipseRing, timeBend,
  //     timeStretch -- see DESIGN STUDIO JUDGMENT above for what each one
  //     looks like and which mood/intent words map to which. `strength` is
  //     0-100, defaults to 50 if omitted -- actually use the range to
  //     express "subtle"/"barely there" (15-30) vs "a bit"/"some" (35-55)
  //     vs "dramatic"/"heavy"/"really faded" (65-90) rather than always
  //     defaulting to 50. `target` picks which placed image(s) it acts on:
  //     omit it (or 'selected') to use whatever the person currently has
  //     selected on the canvas, same as the panel would; 'all' applies it
  //     to every placed image on the current page at once -- only choose
  //     'all' when the person actually says "all"/"every image", never as
  //     a silent default. Throws when nothing is selected and the page has
  //     more than one image -- ask which one they mean rather than
  //     guessing, exactly like a missing required param elsewhere.
  //   pdfed_reshape_image {shape? | new_shape?, source?: 'placed'|'gallery', id?, which?, gallery_index?, target?: 'all',
  //       page_idx?, keep_proportions?, zoom_pct?, focus?: 'auto'|'face'|'center', focus_x?, focus_y?, shape_inset_pct?,
  //       shape_rotate_deg?, shape_flip_h?, shape_flip_v?, bevel?, bevel_style?, border_color?, border_width?, shadow?}
  //     -- Build 275. Cuts image(s) into a built-in shape, a My Shapes entry (`shape`) or a
  //     shape she builds in the same call (`new_shape`: recipe | nodes(+mirror) | path). With
  //     keep_proportions the photo is cropped to the shape; zoom/focus aim the crop, and
  //     focus:'auto'|'face' finds the subject (skin tones, detail, contrast) itself.
  //   spp_studio {photo?: {source:'attached'|'page', which?:'selected'|'last'|'first'|number}, settings?: {...}, playback?: 'play'|'pause'|'restart',
  //       time?: 0..1, compare?: boolean, output?: 'png'|'video'|'place'|'live'}
  //     -- Build 308: texts?: {clear?, update?: [{n,...}], remove?: [n], mode?: 'replace'|'add', items?: [{head, sub, badge, when: 'all'|'photo'|'time', photo (1-based), from, to (0..1 of the loop), pos, size, anim, color, font, align}]}
  //        writes the EXTRA texts (More texts) in the same call, after photos, gallery and settings are applied.
  //     -- Build 280. Kadessa's hands on all of Showcase, in ONE call (a turn carries one action).
  //     Opens Showcase if needed, loads a photo (the one attached in chat, or an image on the open page),
  //     applies ANY mix of `settings` (fit, cutout, tol, trim, soft, motion, fmotion, secs, dir, amp, size,
  //     thick, back, shadow, reflect, bgMode, fillA, fillB, fillGrad, head, sub, badge, txtPos, txtAlign,
  //     scrim, font, txtSize, txtAuto, txtCol, accent, txtAnim, ratio, loops), moves the playhead, and can
  //     export. While Showcase is open, context.activePanel is 'Showcase' and carries settings + a photo
  //     analysis (edge brightness, background colour/busyness, sharpness per export size). Offer this tool
  //     in EVERY context so "make a showcase of this" works from the PDF Editor too.
  //     Full JSON schema: kadessa-showcase-tools.json
  //   spp_reset {} (risk:'confirm')   spp_close {}
  //   pdfed_create_custom_shape {name, recipe|nodes|path, ...}   pdfed_edit_custom_shape {shape, ...}
  //   pdfed_delete_custom_shape {shape}   (risk:'confirm')
  //   pdfed_read_page {pageNumber?: number}
  //     -- Reads a page and returns its text in the Extract Text modal.
  //     Omit pageNumber for whichever page the person currently has open
  //     (context.activePageNumber). Tiered CLIENT-SIDE, same as the manual
  //     Extract Text button: real PDF text layer first (free, exact, no OCR
  //     or AI at all), local OCR (PP-OCR/Tesseract, still free, no AI)
  //     second for flattened/scanned pages or photos. Prefer this over
  //     pdfed_vision_reread_page every time -- it's the free/default path,
  //     and it's the ONLY way pdfed_vision_reread_page becomes usable at
  //     all (see that tool's note). If the local OCR pass comes back
  //     confident, that's the end of it -- there is nothing more to check.
  //   pdfed_vision_reread_page {}
  //     -- Paid fallback: sends the actual page image to GPT-5.6 Luna's
  //     vision input for an exact re-transcription. ONLY offer/call this
  //     right after a pdfed_read_page call this session flagged its OCR
  //     result as uncertain (client throws "there's no recent uncertain
  //     page read to re-check" otherwise, since there's nothing queued to
  //     re-check), or when the person explicitly says the text Kadessa just
  //     read looks wrong/garbled. Never reach for this as a first move, and
  //     never on a page that had a real PDF text layer -- that path is
  //     already exact and this tool has nothing to improve there. This is
  //     risk:'confirm' (a real-money vision API call) unlike almost every
  //     other tool here, so expect the person to be asked before it runs.
  //   pipeline_da_to_diagram {}              pipeline_da_to_pdf {mode: 'live'|'new'}
  //   pipeline_diagram_to_pdf {mode: 'live'|'new'}  pipeline_form_to_pdf {}
  // Only offer tools relevant to context.activePanel on each call -- e.g.
  // don't hand Kadessa the da_* EDITING tools (da_add_row, da_highlight_*,
  // da_set_filter, da_set_dropdown, etc.) while the user's in Make Forms --
  // those only make sense against a table the person can already see.
  // Three kinds of exception to that rule:
  //   1) Pipeline tools -- offer the relevant pipeline_* tool(s) for
  //      whichever module is active (e.g. pipeline_da_to_diagram +
  //      pipeline_da_to_pdf when in Data Arrangement) since those are meant
  //      to move data OUT of the current module, not act within it.
  //   2) navigate_to_panel -- always offered, every turn, every panel.
  //   3) The four "start something new from anywhere" tools -- mf_create_form,
  //      mf_create_from_template, da_create_table, da_create_table_from_template
  //      (plus mf_export_responses_to_da) -- these are also always offered
  //      regardless of activePanel, since each one's own client-side function
  //      switches the person into the right panel itself before it runs.
  //      Everything else in the da_*/mf_*/dg_*/pdfed_* families stays scoped
  //      to its own panel as the blanket rule above says.
  //
  // SEPARATE REQUEST SHAPE -- mode: 'vision_ocr' (used only by
  // pdfed_vision_reread_page, via callKadessaVisionOcr() client-side, never by
  // the normal chat turn above): body is { mode: 'vision_ocr', image:
  // dataUrl, priorOcrText: string } with NO messages/context/tools -- this
  // is a single one-shot transcription request, not a conversational turn.
  // Send `image` to GPT-5.6 Luna as vision input with an instruction to
  // transcribe it EXACTLY (word for word, no summarizing, no paraphrasing,
  // no commentary) and treat `priorOcrText` (the local OCR pass's best
  // guess) as a rough starting point to cross-check against rather than
  // transcribing fully blind -- it's often right about most of the page and
  // only wrong on a few words/lines. Respond with { text: string } only,
  // nothing else -- there's no `reply`/`actions` shape to fill in here.
  //
  // context.pendingAttachments (an ARRAY, present only on a turn where the
  // person just used Kadessa's attach icon, absent otherwise -- one entry per
  // file staged since the last message, so a logo + a spreadsheet + a Word
  // doc attached together arrive as three entries in ONE array, not three
  // separate turns):
  //   { kind: 'logo', name: string, accentColor: string|null }
  //     -- an image was attached. It has ALREADY been written into the
  //     document's logo slot client-side (pdfedRefineState.logoDataUrl) by
  //     the time this request reaches you -- there is no separate "accept
  //     the logo" tool call to make. accentColor is the brand color already
  //     extracted from it (or null if extraction failed/it was flat white).
  //   { kind: 'data', name: string, datasetName: string, headers: string[], rowCount: number, sampleRows: any[][] }
  //     -- a .docx/.xlsx/.csv/.pdf was attached and its content has ALREADY
  //     been parsed and added as a new dataset in Data Arrangement
  //     (daIngestFiles ran client-side before this request was sent) --
  //     there is no separate "import the file" tool call to make either. A
  //     single multi-sheet workbook produces one entry PER SHEET, all
  //     sharing the same `name` (the original filename) but different
  //     `datasetName`s -- treat those as one attachment with several tables,
  //     not several unrelated attachments. sampleRows gives you the actual
  //     cell content (up to 15 rows) of that dataset -- read it the same way
  //     you'd read a table pasted in by hand, not just the row count.
  //   Your job on a pendingAttachments turn is deciding what to DO next with
  //   what's already landed, not accepting or importing it -- that part is
  //   done. Read every entry in the array, not just one, before deciding:
  //   a logo-only array means "make it professional" (see the ACTIONS
  //   paragraph above); a data-only array means read/react to that content;
  //   an array with BOTH a logo and data entries means "here's my branding
  //   and my content, build me the finished report" -- see the ACTIONS
  //   paragraph above for the exact pipeline_da_to_pdf + pdfed_auto_refine_report
  //   pairing that turn calls for.

  let history = [];

  const launcher = document.getElementById('kadessa-launcher');
  const panel = document.getElementById('kadessa-panel');
  const closeBtn = document.getElementById('kadessa-close');
  const thread = document.getElementById('kadessa-thread');
  const form = document.getElementById('kadessa-form');
  const input = document.getElementById('kadessa-input');
  const sendBtn = document.getElementById('kadessa-send');
  const modeTag = document.getElementById('kadessa-mode-tag');
  const attachBtn = document.getElementById('kadessa-attach-btn');
  const attachInput = document.getElementById('kadessa-attach-input');
  const attachChipsEl = document.getElementById('kadessa-attach-chips');
  const actingBadge = document.getElementById('kadessa-acting-badge');

  // kadessaSetActing / kadessaPulseActing -- the visible "she's doing something"
  // signal, kept deliberately separate from the thinking/typing indicator.
  // The thinking vortex covers the gap while Kadessa is composing a reply;
  // this covers the gap while KADESSA_ACTIONS entries are actually running
  // (editing the canvas, pushing a chart, setting the logo, etc.), which
  // can easily outlast the reply itself. Toggling the launcher class works
  // whether the panel is open or closed; the header badge is the same
  // signal for when a person is already looking at the panel.
  let kadessaClaimTimer = null;
  function kadessaSetActing(on){
    launcher.classList.toggle('kadessa-acting', on);
    actingBadge.classList.toggle('show', on);
    if (!on){
      // Clears a claim beat that's still mid-flight when the whole turn
      // wraps up, so a stray timeout can't re-add it after she's done.
      clearTimeout(kadessaClaimTimer);
      launcher.classList.remove('kadessa-action-claim');
    }
  }
  // Re-triggers the "claim" beat (firm scale-snap + ring flash) for each
  // individual action in a multi-action turn, layered on top of the
  // steady lock-ring/radar-ping from kadessaSetActing(true) -- so three
  // actions in a row read as three distinct, deliberate moves instead of
  // one continuous animation that would look the same for one action or five.
  function kadessaPulseActing(){
    launcher.classList.remove('kadessa-action-claim');
    void launcher.offsetWidth; // force reflow so the animation restarts
    launcher.classList.add('kadessa-action-claim');
    clearTimeout(kadessaClaimTimer);
    kadessaClaimTimer = setTimeout(function(){
      launcher.classList.remove('kadessa-action-claim');
    }, 420);
  }

  modeTag.textContent = KADESSA_API.enabled ? '' : 'Demo mode -- no API key connected yet';

  // -----------------------------------------------------------------
  // ATTACHMENTS -- lets a person hand Kadessa a file (a logo, a Word doc,
  // a spreadsheet, a photo) instead of typing everything out or doing
  // the placement by hand. Reuses the app's OWN existing parsers rather
  // than building new ones:
  //   - images  -> fed straight into pdfedSetRefineLogoFromFile (the
  //     exact function the Refine Report modal's own logo upload uses),
  //     so an attached logo is immediately ready for Kadessa's
  //     pdfed_auto_refine_report call, no separate confirmation step.
  //   - .docx/.xlsx/.xls/.csv/.pdf -> handed to daIngestFiles, the same
  //     parser Data Arrangement's own upload button calls, which lands
  //     the real table/content straight into a dataset Kadessa (or the
  //     person) can then push to Diagrams or the PDF.
  //
  // MULTIPLE FILES STAGE TOGETHER: a person handing Kadessa "logo + excel +
  // Word doc" in one go (the whole point of "give her the pieces, she
  // handles the rest") used to only leave the LAST file attached -- every
  // earlier one silently fell out of the chip and out of Kadessa's context,
  // even though it had already landed in the app (logo written, dataset
  // ingested). She'd only ever reason about one file per turn, so a
  // three-file drop never produced the one-shot "here's your finished
  // report" she's supposed to give. Now every file attached before Send
  // stays staged -- its own chip, its own entry in the array below -- so
  // the whole batch travels to Kadessa together and she can read it all
  // (see kadessaAttachmentContextSummary() and context.pendingAttachments).
  // Removing one chip only drops it from the NEXT message; a logo already
  // written into pdfedRefineState or data already pushed into Data
  // Arrangement stays exactly where it landed either way.
  // -----------------------------------------------------------------
  let kadessaPendingAttachments = []; // [{ id, kind: 'logo'|'data', name, ext, dataUrl?, datasets? }]
  let kadessaAttachmentSeq = 0;

  // Small set of inline SVG glyphs so a staged (or already-sent) file reads
  // as an actual file-type icon -- a little PDF/Word/Excel/CSV mark -- not
  // just a name with nothing next to it. Logos get their own real image
  // thumbnail elsewhere (kadessaAttachThumbEl below); this only covers the
  // 'data' kind, keyed off the file extension.
  const KADESSA_FILE_ICONS = {
    pdf: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 2h9l5 5v15H6z" stroke="#ff6b6b" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 2v5h5" stroke="#ff6b6b" stroke-width="1.4" stroke-linejoin="round"/><text x="7.5" y="17" font-size="6.5" fill="#ff6b6b" font-family="Arial" font-weight="700">PDF</text></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 2h9l5 5v15H6z" stroke="#5b9bff" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 2v5h5" stroke="#5b9bff" stroke-width="1.4" stroke-linejoin="round"/><text x="7" y="17" font-size="6" fill="#5b9bff" font-family="Arial" font-weight="700">DOC</text></svg>',
    xls: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 2h9l5 5v15H6z" stroke="#2ec48c" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 2v5h5" stroke="#2ec48c" stroke-width="1.4" stroke-linejoin="round"/><text x="7" y="17" font-size="6" fill="#2ec48c" font-family="Arial" font-weight="700">XLS</text></svg>',
    csv: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 2h9l5 5v15H6z" stroke="#2ec48c" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 2v5h5" stroke="#2ec48c" stroke-width="1.4" stroke-linejoin="round"/><text x="7" y="17" font-size="6" fill="#2ec48c" font-family="Arial" font-weight="700">CSV</text></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 2h9l5 5v15H6z" stroke="#7BA8C4" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 2v5h5" stroke="#7BA8C4" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  };
  function kadessaFileIconKey(ext){
    if (ext === 'pdf') return 'pdf';
    if (ext === 'doc' || ext === 'docx') return 'doc';
    if (ext === 'xls' || ext === 'xlsx') return 'xls';
    if (ext === 'csv') return 'csv';
    return 'file';
  }
  // Builds the one thumbnail element used both in the pre-send chip and in
  // the sent message bubble, so an attachment looks the same wherever it
  // shows up: a real image crop for a logo, a colored file-type glyph for
  // everything else (never a blank space next to the filename).
  function kadessaAttachThumbEl(a){
    if (a.kind === 'logo' && a.dataUrl){
      const img = document.createElement('img');
      img.className = 'kadessa-attach-thumb-img';
      img.src = a.dataUrl;
      img.alt = a.name;
      return img;
    }
    const key = kadessaFileIconKey(a.ext);
    const box = document.createElement('div');
    box.className = 'kadessa-attach-thumb type-' + key;
    box.innerHTML = KADESSA_FILE_ICONS[key];
    return box;
  }

  function kadessaClearAttachments(){
    kadessaPendingAttachments = [];
    attachInput.value = '';
    kadessaRenderAttachmentChips();
  }

  function kadessaRemoveAttachment(id){
    kadessaPendingAttachments = kadessaPendingAttachments.filter(function(a){ return a.id !== id; });
    kadessaRenderAttachmentChips();
  }

  function kadessaRenderAttachmentChips(){
    attachChipsEl.innerHTML = '';
    if (!kadessaPendingAttachments.length){
      attachChipsEl.classList.remove('show');
      return;
    }
    attachChipsEl.classList.add('show');
    kadessaPendingAttachments.forEach(function(a){
      const chip = document.createElement('div');
      chip.className = 'kadessa-attach-chip';
      chip.appendChild(kadessaAttachThumbEl(a));
      const name = document.createElement('span');
      name.className = 'kadessa-attach-chip-name';
      name.textContent = a.name;
      chip.appendChild(name);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'kadessa-attach-chip-remove';
      remove.title = 'Remove attachment';
      remove.textContent = '\u00d7';
      remove.addEventListener('click', function(){ kadessaRemoveAttachment(a.id); });
      chip.appendChild(remove);
      attachChipsEl.appendChild(chip);
    });
  }


  // -----------------------------------------------------------------
  // FILE READING FOR CHAT (v-files). Before this, an attached Word/Excel
  // file was only parsed into a Data Arrangement dataset and Kadessa saw
  // headers + the first 15 rows. Prose came through as a lossy "topic
  // arranged" table, long sheets were cut at row 15, and once Send was
  // pressed the file was forgotten -- a follow-up like "now make slides
  // from it" reached her with no file at all.
  //
  // Now every attached file is ALSO read into faithful plain text
  // (headings, paragraphs, lists, tables in document order for Word;
  // every sheet's rows for Excel/CSV; page text for PDF) and travels with
  // the message as pendingAttachments[i].fileContent. The Worker turns it
  // into a delimited "untrusted file content" block for the model. The
  // last few files are also remembered for the rest of this chat session
  // (context.recentFiles) so follow-up messages still have them.
  // Data Arrangement ingestion is unchanged, so the pipeline_* tools
  // keep working exactly as before.
  // -----------------------------------------------------------------
  const KADESSA_FILE_MAX_CHARS   = 14000; // one file, the turn it is attached
  const KADESSA_TURN_MAX_CHARS   = 32000; // all files together, one turn
  const KADESSA_RECENT_MAX_CHARS = 6000;  // one remembered file, later turns
  const KADESSA_RECENT_MAX_FILES = 3;
  let kadessaFileMemory = []; // [{ name, fileType, content, truncated, charCount }]

  function kadessaTidy(t){ return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }

  function kadessaFileTypeOf(ext){
    if (ext === 'docx') return 'word';
    if (ext === 'xlsx' || ext === 'xls') return 'excel';
    if (ext === 'csv' || ext === 'tsv') return 'csv';
    if (ext === 'pdf') return 'pdf';
    return 'text';
  }

  // Word: mammoth's HTML, walked in order, so a menu's sections, a
  // carousel's slide list or a proposal's tables keep their real structure.
  function kadessaWordHtmlToText(root){
    const out = [];
    (function walk(node){
      Array.from(node.children || []).forEach(function(el){
        const tag = el.tagName;
        if (/^H[1-6]$/.test(tag)){
          const t = kadessaTidy(el.textContent);
          if (t) out.push('\n' + '#'.repeat(+tag.charAt(1)) + ' ' + t);
        } else if (tag === 'P'){
          const t = kadessaTidy(el.textContent);
          if (t) out.push(t);
        } else if (tag === 'UL' || tag === 'OL'){
          Array.from(el.children).forEach(function(li, i){
            const t = kadessaTidy(li.textContent);
            if (t) out.push((tag === 'OL' ? (i + 1) + '. ' : '- ') + t);
          });
        } else if (tag === 'TABLE'){
          Array.from(el.querySelectorAll('tr')).forEach(function(tr){
            const cells = Array.from(tr.children).map(function(c){ return kadessaTidy(c.textContent); });
            if (cells.some(Boolean)) out.push('| ' + cells.join(' | ') + ' |');
          });
        } else {
          walk(el);
        }
      });
    })(root);
    return out.join('\n');
  }

  async function kadessaReadWord(buf){
    if (typeof mammoth === 'undefined') throw new Error('Word reader not loaded');
    const res = await mammoth.convertToHtml({ arrayBuffer: buf });
    const doc = new DOMParser().parseFromString(res.value, 'text/html');
    const text = kadessaWordHtmlToText(doc.body);
    const imgs = doc.querySelectorAll('img').length;
    return {
      text: text,
      stats: {
        headings: doc.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        tables: doc.querySelectorAll('table').length,
        words: text.split(/\s+/).filter(Boolean).length,
        images: imgs
      },
      note: imgs ? (imgs + ' image(s) inside the Word file were not read, only its text.') : ''
    };
  }

  // Excel/CSV: every sheet gets its own share of the budget, so a big
  // first sheet can't crowd out the second one.
  function kadessaReadWorkbook(wb, maxChars){
    if (typeof XLSX === 'undefined') throw new Error('Excel reader not loaded');
    const names = wb.SheetNames.slice(0, 12);
    const perSheet = Math.max(2500, Math.floor(maxChars / Math.max(1, names.length)));
    const parts = [];
    const sheets = [];
    names.forEach(function(name){
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false, raw: false });
      const cols = aoa.reduce(function(m, r){ return Math.max(m, r.length); }, 0);
      sheets.push({ name: name, rows: aoa.length, cols: cols });
      let block = '## Sheet: ' + name + ' (' + aoa.length + ' rows x ' + cols + ' cols)\n';
      let used = block.length, shown = 0;
      for (let i = 0; i < aoa.length; i++){
        const cells = aoa[i].map(function(v){ return kadessaTidy(v); });
        while (cells.length && cells[cells.length - 1] === '') cells.pop();
        const line = cells.join('\t') + '\n';
        if (used + line.length > perSheet) break;
        block += line; used += line.length; shown++;
      }
      if (shown < aoa.length) block += '... (' + (aoa.length - shown) + ' more rows not shown)\n';
      parts.push(block);
    });
    if (wb.SheetNames.length > names.length) parts.push('... (' + (wb.SheetNames.length - names.length) + ' more sheets not shown)');
    return { text: parts.join('\n'), stats: { sheets: sheets }, note: '' };
  }

  async function kadessaReadPdf(buf){
    if (typeof pdfjsLib === 'undefined') throw new Error('PDF reader not loaded');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = Math.min(pdf.numPages, 20);
    const out = [];
    for (let p = 1; p <= pages; p++){
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const t = tc.items.map(function(it){ return it.str + (it.hasEOL ? '\n' : ' '); }).join('').replace(/[ \t]+/g, ' ').trim();
      out.push('## Page ' + p + '\n' + t);
    }
    const text = out.join('\n\n');
    let note = '';
    if (pdf.numPages > pages) note = 'Only the first ' + pages + ' of ' + pdf.numPages + ' pages were read.';
    if (text.replace(/## Page \d+/g, '').replace(/\s+/g, '').length < 20) note = 'This PDF has no readable text layer (likely a scan or images).';
    return { text: text, stats: { pages: pdf.numPages }, note: note };
  }

  // Returns { fileType, content, truncated, charCount, stats, note } or
  // { fileType, note } if reading failed. Never throws: a failure here
  // must not break the Data Arrangement ingest that already happened.
  async function kadessaReadFileForChat(file, ext){
    const fileType = kadessaFileTypeOf(ext);
    try {
      let r;
      if (fileType === 'word'){
        r = await kadessaReadWord(await file.arrayBuffer());
      } else if (fileType === 'excel'){
        r = kadessaReadWorkbook(XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' }), KADESSA_FILE_MAX_CHARS);
      } else if (fileType === 'pdf'){
        r = await kadessaReadPdf(await file.arrayBuffer());
      } else if (fileType === 'csv'){
        const wb = XLSX.read(await file.text(), { type: 'string', FS: ext === 'tsv' ? '\t' : undefined, raw: true });
        r = kadessaReadWorkbook(wb, KADESSA_FILE_MAX_CHARS);
      } else {
        r = { text: await file.text(), stats: {}, note: '' };
      }
      let text = String(r.text || '').replace(/\u0000/g, '');
      const total = text.length;
      const truncated = total > KADESSA_FILE_MAX_CHARS || /more rows not shown|more sheets not shown/.test(text);
      if (total > KADESSA_FILE_MAX_CHARS) text = text.slice(0, KADESSA_FILE_MAX_CHARS);
      return { fileType: fileType, content: text, truncated: truncated, charCount: total, stats: r.stats || {}, note: r.note || '' };
    } catch (err){
      console.warn('Kadessa could not read file text', file.name, err);
      return { fileType: fileType, note: 'The file text could not be read (' + (err && err.message ? err.message : 'unknown error') + ').' };
    }
  }

  // Later turns: the few most recent files, shorter excerpts.
  function kadessaRememberAttachments(list){
    list.forEach(function(a){
      if (a.kind !== 'data' || !a.fileContent) return;
      kadessaFileMemory = kadessaFileMemory.filter(function(m){ return m.name !== a.name; });
      kadessaFileMemory.push({
        name: a.name,
        fileType: a.fileType,
        content: a.fileContent.slice(0, KADESSA_RECENT_MAX_CHARS),
        truncated: !!a.contentTruncated || a.fileContent.length > KADESSA_RECENT_MAX_CHARS,
        charCount: a.charCount || a.fileContent.length
      });
    });
    if (kadessaFileMemory.length > KADESSA_RECENT_MAX_FILES) kadessaFileMemory = kadessaFileMemory.slice(-KADESSA_RECENT_MAX_FILES);
  }
  function kadessaRecentFilesContext(excludeNames){
    const skip = excludeNames || [];
    return kadessaFileMemory
      .filter(function(m){ return skip.indexOf(m.name) === -1; })
      .map(function(m){ return { name: m.name, fileType: m.fileType, content: m.content, contentTruncated: m.truncated, charCount: m.charCount }; });
  }
  function kadessaDecorateContext(ctx, pending, recent){
    let out = ctx;
    if (pending) out = Object.assign({}, out || {}, { pendingAttachments: pending });
    if (recent && recent.length) out = Object.assign({}, out || {}, { recentFiles: recent });
    // Build 245: every form in the session (ids, titles, response counts,
    // field labels, published state, whether its table is already in Data
    // Arrangement), so Kadessa can tell WHICH form's responses are meant, from
    // any wired panel, not only Make Forms. Only added when a panel context
    // already exists, so panels that send no context still send none.
    if (out && out.activePanel && typeof mfFormsOverviewForKadessa === 'function') {
      try {
        const forms = mfFormsOverviewForKadessa();
        if (forms.length) out = Object.assign({}, out, { forms: forms });
      } catch (e) { /* never let this break a chat turn */ }
    }
    return out;
  }

  async function kadessaHandleAttachmentFile(file){
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
    try {
      if (IMAGE_EXTS.indexOf(ext) !== -1){
        // Images are staged as a logo candidate right away -- the same
        // action a person takes by uploading a logo in the Refine Report
        // modal, just triggered from chat instead. If Kadessa's reply makes
        // clear the person meant something else (a photo to insert, a
        // screenshot of a table), she can still act on it differently;
        // this just means the logo is ALREADY in place the moment she
        // decides to use it, no extra round trip needed.
        const dataUrl = await pdfedSetRefineLogoFromFile(file);
        kadessaPendingAttachments.push({ id: ++kadessaAttachmentSeq, kind: 'logo', name: file.name, ext: ext, dataUrl: dataUrl });
      } else {
        // Word/Excel/CSV/PDF -- straight into Data Arrangement via the
        // app's own real parser (mammoth for .docx, SheetJS for .xlsx,
        // the smart multi-strategy parser for csv/pdf). Runs immediately
        // on attach, not on send, so the person sees the result land in
        // Data Arrangement right away and Kadessa gets a finished dataset
        // to work from rather than a raw file to somehow parse herself.
        // Snapshot which datasets exist before/after so THIS attachment
        // keeps a pointer to exactly the dataset(s) it created (usually
        // one, occasionally more for a multi-sheet workbook), even when
        // other files are ingested before or after it in the same batch.
        const before = (typeof daState !== 'undefined' && daState.datasets) ? daState.datasets.length : 0;
        await daIngestFiles([file]);
        const after = (typeof daState !== 'undefined' && daState.datasets) ? daState.datasets.length : before;
        const newDatasets = (typeof daState !== 'undefined' && daState.datasets) ? daState.datasets.slice(before, after) : [];
        // Also read the file's real text for Kadessa (never throws).
        const read = await kadessaReadFileForChat(file, ext);
        kadessaPendingAttachments.push({
          id: ++kadessaAttachmentSeq, kind: 'data', name: file.name, ext: ext, datasets: newDatasets,
          fileType: read.fileType, fileContent: read.content || '', contentTruncated: !!read.truncated,
          charCount: read.charCount || 0, fileStats: read.stats || null, readNote: read.note || ''
        });
      }
    } catch (err){
      console.error('Kadessa attachment failed', file.name, err);
      toast('Couldn\'t read "' + file.name + '", ' + (err && err.message ? err.message : 'unsupported or corrupted file'), 'error');
    } finally {
      kadessaRenderAttachmentChips();
    }
  }

  attachBtn.addEventListener('click', function(){ attachInput.click(); });
  attachInput.addEventListener('change', async function(){
    const files = Array.from(attachInput.files || []);
    if (!files.length) return;
    // Every file picked (or dropped in across several attach clicks before
    // Send) stages as its own chip and its own entry -- a logo plus an
    // excel plus a Word doc all travel together on the next message. Files
    // are handled one at a time (not Promise.all) so two ingests never
    // race on daState.datasets while snapshotting before/after lengths above.
    for (const f of files) await kadessaHandleAttachmentFile(f);
    attachInput.value = '';
  });

  // -----------------------------------------------------------------
  // Only show Kadessa to signed-in users. Hidden by default; revealed
  // once a real Supabase session is confirmed, and re-checked live
  // on sign-in/sign-out so it never needs a page refresh.
  // -----------------------------------------------------------------
  launcher.style.display = 'none';
  panel.classList.remove('open');

  async function kadessaRefreshVisibility(){
    try{
      const { data: { session } } = await sarvarcSupabase.auth.getSession();
      if(session && session.user){
        launcher.style.display = 'flex';
      } else {
        launcher.style.display = 'none';
        panel.classList.remove('open');
      }
    } catch(e){
      launcher.style.display = 'none';
    }
  }

  kadessaRefreshVisibility();
  try{
    sarvarcSupabase.auth.onAuthStateChange(function(){ kadessaRefreshVisibility(); });
  } catch(e){ /* Supabase not ready yet on this tick, visibility check above still ran */ }

  launcher.addEventListener('click', function(){
    panel.classList.toggle('open');
    if(panel.classList.contains('open')){
      if(thread.children.length === 0){
        addMsg('kadessa', "Hi, I'm Kadessa. Ask me about redacting a file, tidying a messy chart, or refining a report into your letterhead.");
      }
      // Flush anything the background watcher noticed while the panel was
      // closed -- it was held back rather than dropped, so opening the
      // panel is when the person actually sees it.
      if(kadessaEyesPendingProactive.length){
        kadessaEyesPendingProactive.forEach(function(t){ addMsg('kadessa', t); });
        kadessaEyesPendingProactive = [];
      }
      kadessaEyesShowBadge(false);
    }
  });
  closeBtn.addEventListener('click', function(){ panel.classList.remove('open'); });

  function addMsg(who, text, attachments){
    const div = document.createElement('div');
    div.className = 'kadessa-msg ' + who;
    // When this turn carried files, show what was actually sent/received as
    // small thumbnails inside the bubble itself -- otherwise, once the
    // staged chips clear after Send, the thread has no visual record at all
    // that anything was attached, and the message reads as an unexplained
    // blank caption ("Here's the file, use it..." with nothing to look at).
    if (attachments && attachments.length){
      const row = document.createElement('div');
      row.className = 'kadessa-msg-attachments';
      attachments.forEach(function(a){
        const item = document.createElement('div');
        item.className = 'kadessa-msg-attach-item';
        item.appendChild(kadessaAttachThumbEl(a));
        const label = document.createElement('span');
        label.textContent = a.name;
        item.appendChild(label);
        row.appendChild(item);
      });
      div.appendChild(row);
    }
    if (text){
      const textEl = document.createElement('span');
      textEl.className = 'kadessa-msg-text';
      textEl.textContent = text;
      div.appendChild(textEl);
    }
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;
    return div;
  }

  // Thinking indicator: animated particle-collapse + a label that alternates
  // through phrases DERIVED FROM THE REAL WORKSPACE STATE (via getKadessaContext()),
  // not a fixed hardcoded set -- "Scanning your table (12 rows)" instead of a
  // generic "Looking at your workspace" that's true no matter what the user is
  // doing. Falls back to generic phrasing only when no context is available
  // (e.g. Redaction, which isn't wired into getKadessaContext() yet).
  // Cycle stops and cleans itself up via resolveThinkingMsg().
  function buildThinkingLabels(ctx){
    const generic = ['Kadessa is thinking', 'Working on it', 'Almost there'];
    if (!ctx || !ctx.activePanel) return generic;

    if (ctx.activePanel === 'Data Arrangement'){
      return [
        'Kadessa is thinking',
        'Scanning your table (' + ctx.totalRowCount + ' row' + (ctx.totalRowCount === 1 ? '' : 's') + ')',
        ctx.emptyCellsInSample > 0 ? 'Checking for gaps in the data' : 'Checking the data',
        'Almost there'
      ];
    }
    if (ctx.activePanel === 'PDF Editor'){
      return [
        'Kadessa is thinking',
        'Looking at page ' + ctx.activePageNumber + ' of ' + ctx.totalPages,
        'Working on it',
        'Almost there'
      ];
    }
    if (ctx.activePanel === 'Make Forms'){
      return [
        'Kadessa is thinking',
        ctx.formTitle ? 'Reviewing "' + ctx.formTitle + '"' : 'Reviewing your form',
        'Checking ' + ctx.fieldCount + ' field' + (ctx.fieldCount === 1 ? '' : 's'),
        'Almost there'
      ];
    }
    if (ctx.activePanel === 'Diagrams & Graphs'){
      return [
        'Kadessa is thinking',
        'Studying your ' + ctx.chartType + ' chart',
        'Working on it',
        'Almost there'
      ];
    }
    return generic;
  }

  function addThinkingMsg(ctx){
    const labels = buildThinkingLabels(ctx);
    const div = document.createElement('div');
    div.className = 'kadessa-msg kadessa kadessa-thinking';
    div.innerHTML =
      '<span class="kadessa-vortex">' +
        '<span class="kadessa-particle" style="--px:9px; --py:-9px; animation-delay:0s;"></span>' +
        '<span class="kadessa-particle" style="--px:-10px; --py:6px; animation-delay:0.35s;"></span>' +
        '<span class="kadessa-particle" style="--px:8px; --py:9px; animation-delay:0.7s;"></span>' +
        '<span class="kadessa-particle" style="--px:-7px; --py:-8px; animation-delay:1.05s;"></span>' +
        '<span class="kadessa-vortex-core"></span>' +
      '</span>' +
      '<span class="kadessa-thinking-label">' + labels[0] + '</span>';
    thread.appendChild(div);
    thread.scrollTop = thread.scrollHeight;

    let i = 0;
    const labelEl = div.querySelector('.kadessa-thinking-label');
    div._kadessaLabelTimer = setInterval(function(){
      i = (i + 1) % labels.length;
      labelEl.style.opacity = '0';
      setTimeout(function(){
        labelEl.textContent = labels[i];
        labelEl.style.opacity = '1';
      }, 180);
    }, 1800);

    return div;
  }

  function resolveThinkingMsg(div, text){
    if (div._kadessaLabelTimer) clearInterval(div._kadessaLabelTimer);
    div.classList.remove('kadessa-thinking');
    div.innerHTML = '';
    div.textContent = text;
  }

  // -----------------------------------------------------------------
  // getKadessaContext(): pulls whatever the app currently knows about the
  // active document/panel so Kadessa can reason about vague feedback like
  // "this looks awkward" instead of guessing blind.
  //
  // Wired so far: Data Arrangement, PDF Editor, Make Forms, Diagrams & Graphs.
  // Redaction isn't wired yet -- that returns null still.
  //
  // NOTE ON PRIVACY:
  // - Data Arrangement: sends a SAMPLE of real cell values (see note below).
  // - PDF Editor: sends only lightweight page METADATA (page count, current
  //   page type, whether it's been edited, current tool/zoom). It never
  //   sends the actual page image/dataUrl -- that would mean uploading the
  //   user's actual document content, which goes against the "pipeline not
  //   file collection" stance. This keeps Kadessa aware of *state*, not *content*.
  // - Make Forms: sends the form's structure (title, description, field
  //   labels/types/required flags) -- not any submitted response data.
  // -----------------------------------------------------------------
  function getKadessaContextBase(){
    try{
      // Showcase is an overlay, not a panel: while it is open she works in it.
      if (window.sppKadessa && window.sppKadessa.isOpen()){
        const sc = window.sppKadessa.context();
        sc.attachedImages = kadessaPendingAttachments.filter(function(a){ return a.kind === 'logo' && a.dataUrl; }).map(function(a){ return a.name; });
        return sc;
      }
      const sec = (typeof unifiedActiveSection === 'function') ? unifiedActiveSection() : '';

      if (sec === 'dataarrange' && typeof daState !== 'undefined'){
        const hasDatasets = !!(daState.datasets && daState.datasets.length);
        const ds = hasDatasets
          ? ((daState.activeId && daState.datasets.find(function(d){ return d.id === daState.activeId; })) || daState.datasets[0])
          : null;
        // No table open yet (the "Drop your file here" / blank-state screen).
        // Still report activePanel so the Worker keeps offering
        // da_create_table / da_create_table_from_template here -- table
        // creation is exactly the action needed on THIS screen, so it must
        // not require a table to already exist.
        if (!ds){
          return {
            activePanel: 'Data Arrangement',
            noTableOpen: true,
            datasetName: null,
            headers: [],
            totalRowCount: 0,
            sampleRows: [],
            emptyCellsInSample: 0,
            columnStats: [],
            activeFilter: null
          };
        }
        if(ds){
          const sampleRows = (ds.rows || []).slice(0, 15);
          let emptyCells = 0;
          sampleRows.forEach(function(row){
            row.forEach(function(cell){
              if(cell === '' || cell === null || cell === undefined) emptyCells++;
            });
          });
          // Raw rows beyond #15 are never sent (payload size), but Kadessa
          // still needs to reason about the WHOLE column for things like
          // "mark important values" or "flag anything above average" --
          // so instead of more rows, she gets a per-column summary computed
          // over every row. For a numeric column that's min/max/avg/count;
          // for a text column it's the most common values and their
          // counts (capped at 5) so she can reason about categories
          // ("mostly 'Paid', a few 'Overdue'") without seeing every row.
          // This is what backs da_highlight_by_condition/_top_bottom, which
          // apply against ds.rows in full, not this summary -- the summary
          // is only for Kadessa to DECIDE the rule, the actions do the actual
          // whole-table scan themselves.
          const columnStats = (ds.headers || []).map(function(h, ci){
            const nums = [];
            const textCounts = {};
            let nonEmpty = 0;
            (ds.rows || []).forEach(function(row, ri){
              let v = row[ci];
              if (typeof v === 'string' && v.trim().startsWith('=')) {
                v = daFormulaDisplayValue(ds, ri, ci).display;
              }
              if (v === '' || v === null || v === undefined) return;
              nonEmpty++;
              // Build 299: currency-aware (₹2,22,000.00, (4,500), 1.2Cr) so money columns count as numbers.
              const n = daFilterNum(v);
              if (!isNaN(n) && String(v).trim() !== '') nums.push(n);
              const key = String(v).trim();
              textCounts[key] = (textCounts[key] || 0) + 1;
            });
            const stat = { colIdx: ci, header: h, nonEmptyCount: nonEmpty };
            if (nums.length) {
              stat.numericCount = nums.length;
              stat.min = Math.min.apply(null, nums);
              stat.max = Math.max.apply(null, nums);
              stat.avg = Math.round((nums.reduce(function(a,b){ return a+b; }, 0) / nums.length) * 100) / 100;
            } else {
              stat.topValues = Object.keys(textCounts)
                .sort(function(a, b){ return textCounts[b] - textCounts[a]; })
                .slice(0, 5)
                .map(function(k){ return { value: k, count: textCounts[k] }; });
            }
            return stat;
          });
          // Lets Kadessa answer "is a filter on right now?" and build on top of
          // one ("also hide the empty rows") without needing the user to
          // describe the current state themselves. Mirrors the shape
          // da_set_filter takes so the model can echo/extend it directly.
          const activeFilterRules = (typeof daFilterActiveRules === 'function') ? daFilterActiveRules(ds) : [];
          const activeFilter = activeFilterRules.length ? {
            match: daFilterGetState(ds).match,
            rules: activeFilterRules.map(function(r){ return { colIdx: r.col, operator: r.op, value: r.val, value2: r.val2 }; })
          } : null;
          const filteredView = kadessaFilteredViewForContext(ds);
          return Object.assign({
            activePanel: 'Data Arrangement',
            datasetName: ds.name,
            headers: ds.headers || [],
            totalRowCount: (ds.rows || []).length,
            sampleRows: sampleRows,
            emptyCellsInSample: emptyCells,
            columnStats: columnStats,
            activeFilter: activeFilter
          }, filteredView);
        }
      }

      if (sec === 'pdfeditor' && typeof pdfed !== 'undefined' && pdfed.pages && pdfed.pages.length){
        const page = pdfed.pages[pdfed.active] || pdfed.pages[0];
        const tableFontSizes = page && page.placedTables ? page.placedTables.map(function(t){ return t.fontSize; }).filter(function(v){ return v != null; }) : [];

        // ── Layout geometry check ──────────────────────────────────────
        // Real x/y/w/h numbers, not a guess. Page size falls back to A4 at
        // the same 3.7795 px/mm the rest of the editor uses when a page
        // hasn't set its own pageMM. Every placed table/text/image becomes
        // one bounding box; from those we compute concrete, checkable
        // issues (off-page content, overlapping items, a logo sitting
        // somewhere other than the header band) instead of asking Kadessa to
        // eyeball pixel positions from a description.
        let layoutIssues = [];
        let items = [];
        let overlapReport = [];
        let shapeItems = [];
        const zRank = (typeof pdfedKadessaZRankMap === 'function') ? pdfedKadessaZRankMap(page) : {};
        if (page){
          const PXMM = 3.7795;
          const pgMM = page.pageMM || [210, 297];
          const pageW = pgMM[0] * PXMM, pageH = pgMM[1] * PXMM;

          (page.placedTables || []).forEach(function(t){
            const w = (t.colWidths || []).reduce(function(a,b){ return a+b; }, 0);
            const h = (t.rowHeights || []).reduce(function(a,b){ return a+b; }, 0);
            items.push({ id: t.id, type: 'table', z: zRank[t.id], x: t.x, y: t.y, w: w, h: h, locked: !!t.locked });
          });
          (page.placedTexts || []).forEach(function(t){
            items.push({
              id: t.id, type: t._reportHeaderText ? 'header text' : 'text', z: zRank[t.id], x: t.x, y: t.y,
              // Build 278: the box's REAL rendered size (text boxes have no stored height).
              w: (typeof pdfedKadessaCtxSize === 'function' ? pdfedKadessaCtxSize(page, 'text', t)[0] : (t.w || 0)),
              h: (typeof pdfedKadessaCtxSize === 'function' ? pdfedKadessaCtxSize(page, 'text', t)[1] : (t.h || 0)),
              locked: !!t.locked,
              // A short snippet, not the full string -- enough for Kadessa to match "the
              // heading" / a quoted phrase to a real id without bloating the payload.
              text: String(t.text || '').slice(0, 60),
              fontSizePx: t.fontSize || null,
              color: (typeof t.color === 'string' ? t.color : null),
              opacityPct: Math.round((typeof pdfedGetOpacity === 'function' ? pdfedGetOpacity(t) : (t.opacity != null ? t.opacity : 1)) * 100)
            });
          });
          (page.placedImages || []).forEach(function(im){
            items.push({
              id: im.id, type: im.kind === 'logo' ? 'logo' : (im.kind === 'signature' ? 'signature' : 'image'), z: zRank[im.id],
              decor: (typeof pdfedKadessaIsDecor === 'function' && pdfedKadessaIsDecor(im)) || undefined,
              x: im.x, y: im.y, w: im.w, h: im.h,
              shapedAs: im.shapedAs || undefined,
              liveClip: im.clip ? true : undefined,
              look: (im.clip && im.clip.look) ? { shape: (im.clip.look.shape && (im.clip.look.shape.name || im.clip.look.shape.id)) || undefined, filter: (im.clip.look.fx && im.clip.look.fx.preset) || undefined, strength: (im.clip.look.fx && im.clip.look.fx.strength) } : undefined,
              locked: !!im.locked,
              opacityPct: Math.round((typeof pdfedGetOpacity === 'function' ? pdfedGetOpacity(im) : (im.opacity != null ? im.opacity : 1)) * 100)
            });
          });

          (page.placedShapes || []).forEach(function(sh){
            shapeItems.push({ id: sh.id, type: 'shape', z: zRank[sh.id], x: sh.x, y: sh.y, w: sh.w, h: sh.h, locked: !!sh.locked });
          });
          (page.placedBorders || []).forEach(function(bd){
            shapeItems.push({ id: bd.id, type: 'border', z: zRank[bd.id], x: bd.x, y: bd.y, w: bd.w, h: bd.h, locked: !!bd.locked });
          });

          items.forEach(function(it){
            if (it.x < 0 || it.y < 0 || it.x + it.w > pageW || it.y + (it.h || 0) > pageH){
              layoutIssues.push(it.type + ' (' + it.id + ') extends past the page edge');
            }
          });

          // Build 278: overlaps are measured from the REAL rendered boxes and classified, so a
          // picture placed behind text on purpose is not reported as a problem.
          overlapReport = (typeof pdfedKadessaAnalyzeOverlaps === 'function') ? pdfedKadessaAnalyzeOverlaps(page, pdfed.active) : [];
          overlapReport.forEach(function(o){
            if (!o.intentional) layoutIssues.push(o.type + ': ' + o.a + ' (lower) and ' + o.b + ' (upper), ' + o.overlapPct + '% overlap, ' + o.note);
          });

          const logo = items.find(function(it){ return it.type === 'logo'; });
          if (logo && logo.y > pageH * 0.25){
            layoutIssues.push('logo sits at y=' + Math.round(logo.y) + ', well below the header band (top ~25% of the page) -- likely misplaced');
          }

          const bodyXs = items.filter(function(it){ return it.type === 'table' || it.type === 'text'; }).map(function(it){ return it.x; });
          if (bodyXs.length > 1){
            const spread = Math.max.apply(null, bodyXs) - Math.min.apply(null, bodyXs);
            if (spread > 40) layoutIssues.push('content left-edges vary by ~' + Math.round(spread) + 'px -- items don\'t share a common left margin');
          }
        }

        return {
          activePanel: 'PDF Editor',
          totalPages: pdfed.pages.length,
          activePageNumber: pdfed.active + 1,
          activePageType: page ? page.type : null,
          activePageModified: page ? !!page.modified : null,
          activePageLabel: page ? (page.label || null) : null,
          currentTool: (typeof pdfedAnnotState !== 'undefined') ? pdfedAnnotState.tool : null,
          zoom: pdfed.zoom,
          cropActive: pdfed.cropActive,
          refineReportUsedOnThisDoc: pdfed.refineReportUsed,
          tableCount: page && page.placedTables ? page.placedTables.length : 0,
          textBlockCount: page && page.placedTexts ? page.placedTexts.length : 0,
          imageCount: page && page.placedImages ? page.placedImages.length : 0,
          tableFontSizesVary: tableFontSizes.length > 1 && new Set(tableFontSizes).size > 1,
          layoutIssues: layoutIssues.slice(0, 10),
          // Real per-item id + geometry + (for text) a short content snippet, so a
          // resize/opacity request Kadessa has already understood visually (via
          // pdfed_read_page) or from the person's own description can be grounded
          // to an exact id instead of guessing by "first"/"last"/position -- see
          // pdfed_resize_image/pdfed_resize_text/pdfed_set_opacity. Capped so this
          // never balloons the context on a page with dozens of small placed items.
          placedItems: items.concat(shapeItems).slice(0, 30),
          // Build 278: back-to-front list of ids, the measured overlaps on this page, and the flag
          // the Worker uses to know this client has pdfed_move_item / _arrange_layer / _resolve_overlaps.
          stackOrder: Object.keys(zRank).sort(function(a, b){ return zRank[a] - zRank[b]; }).slice(0, 40),
          overlaps: overlapReport.slice(0, 12),
          assetLayout: (typeof pdfedKadessaMoveItem === 'function'),
          showcaseHands: !!window.sppKadessa,
          // Build 275: presence of imageShaper is how the Worker knows this client has the full shape builder.
          imageShaper: (typeof pdfedKadessaShaperContext === 'function') ? pdfedKadessaShaperContext() : undefined,
          liveClipLook: true,
          galleryImages: (typeof pdfedKadessaGalleryContext === 'function') ? pdfedKadessaGalleryContext() : undefined,
          // Build 242: real page size in canvas px, the page's own background
          // colour, and how far down the page existing content already reaches
          // (percent of page height). Kadessa uses these with the screenshot to
          // choose a region for pdfed_add_text_to_page.
          pageSizePx: (typeof pdfedKadessaPageSizePx === 'function') ? pdfedKadessaPageSizePx(page, pdfed.active) : null,
          // Build 277: real page size in mm (so Kadessa knows A4 vs 16:9), and the flag the Worker
          // uses to know this client has pdfed_resize_canvas.
          pageMM: page ? (page.pageMM || null) : null,
          canvasResize: (typeof pdfedKadessaResizeCanvas === 'function'),
          pageBgColor: page ? (page.bgColor || null) : null,
          contentBottomPct: (function(){
            try {
              if (typeof pdfedKadessaPageSizePx !== 'function' || !page) return null;
              const sz = pdfedKadessaPageSizePx(page, pdfed.active);
              return Math.round(Math.min(100, pdfedKadessaContentBottomPx(page, pdfed.active) / sz[1] * 100));
            } catch (e) { return null; }
          })(),
          // Page transitions already set (afterPage N = the change from page N to N+1) and a
          // light per-page overview, so Kadessa can choose transitions from what the document
          // actually is instead of guessing. Full text still comes from pdfed_read_page.
          pageTransitions: (function(){
            try {
              const out = [];
              for (let i = 0; i < pdfed.pages.length - 1; i++) {
                const a = pdfedAnimGet(pdfed.pages[i]);
                if (a) out.push({ afterPage: i + 1, type: a.type, label: a.label || undefined, ms: a.ms });
              }
              return out;
            } catch (e) { return []; }
          })(),
          pagesOverview: (function(){
            try {
              return pdfed.pages.slice(0, 40).map(function(pg, i){
                let snip = '';
                try { const t0 = (pg.placedTexts || [])[0]; snip = t0 ? String(t0.text || t0.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) : ''; } catch (e2) {}
                return { n: i + 1, type: pg.type, label: pg.label || undefined, texts: (pg.placedTexts || []).length, images: (pg.placedImages || []).length, tables: (pg.placedTables || []).length, firstText: snip || undefined };
              });
            } catch (e) { return []; }
          })()
          // Deliberately NOT included: page.dataUrl (the actual rendered image/content),
          // and text/tables beyond the 60-char snippet above -- use pdfed_read_page for
          // the full page content.
        };
      }

      // FIX: PDF Editor open but EMPTY (no pages yet). Before this, the block above
      // only ran when pdfed.pages had at least one page, so an empty editor sent
      // Kadessa NO context at all (null), the Worker offered her only generic tools,
      // and she said she couldn't create a page. Now she gets a minimal context so
      // pdfed_insert_page is offered. layoutIssues is deliberately left out so the
      // background "eyes" watcher (needs an array) stays quiet on an empty editor.
      if (sec === 'pdfeditor' && typeof pdfed !== 'undefined' && (!pdfed.pages || !pdfed.pages.length)){
        return {
          activePanel: 'PDF Editor',
          totalPages: 0,
          activePageNumber: 0,
          noDocumentOpen: true,
          imageShaper: (typeof pdfedKadessaShaperContext === 'function') ? pdfedKadessaShaperContext() : undefined,
          liveClipLook: true,
          galleryImages: (typeof pdfedKadessaGalleryContext === 'function') ? pdfedKadessaGalleryContext() : undefined
        };
      }

      if (sec === 'makeforms' && typeof mfState !== 'undefined'){
        if (mfState.forms && mfState.forms.length){
          const form = mfState.forms.find(function(f){ return f.id === mfState.currentId; }) || mfState.forms[0];
          if(form){
            // responseCount/isPublished let Kadessa answer "how many responses
            // did I get" or reason about whether syncing/exporting makes
            // sense without needing a round trip just to check -- and let
            // her word her replies accurately (e.g. not offering to "check
            // for new online responses" on a form that was never published).
            const responses = (typeof mfGetResponses === 'function') ? mfGetResponses(form) : (form.responses || []);
            return {
              activePanel: 'Make Forms',
              // Build 245: the fallback above picks forms[0] when nothing is
              // open (gallery view), so say plainly whether THIS form is the
              // one on screen and give its id -- otherwise "this form" would
              // silently mean "the first form in the list".
              formId: form.id,
              formIsOpenInEditor: form.id === mfState.currentId,
              formTitle: form.title,
              formDescription: form.desc || '',
              fieldCount: (form.fields || []).length,
              fields: (form.fields || []).map(function(f){
                return { type: f.type, label: f.label, required: !!f.required };
              }),
              isPublished: !!form.publishedId,
              shareUrl: form.publishedId ? (SARVARC_FORMS_PUBLIC_BASE_URL + '/?f=' + form.shareSlug) : null,
              responseCount: responses.length
            };
          }
        }
        // No form open yet (fresh "My Forms" gallery, 0 forms, or none
        // selected). Without this branch, getKadessaContext fell through to
        // `return null` here, which meant context.activePanel was
        // undefined -- and since toolsForContext() looks up tools by
        // activePanel, that silently hid EVERY Make Forms tool (including
        // mf_create_form) any time the gallery was empty. That's the
        // second half of why "create a form" did nothing: even after
        // adding mf_create_form, the backend would never have been told
        // it was allowed to offer it.
        return {
          activePanel: 'Make Forms',
          formTitle: null,
          formDescription: '',
          fieldCount: 0,
          fields: [],
          noFormOpenYet: true
        };
      }

      if (sec === 'diagrams' && typeof dgState !== 'undefined'){
        // Wrapped separately from the outer function-level try/catch: if any
        // of the richer detail-gathering below (column type detection,
        // grouped-series mapping, etc.) throws on some real-world dataset
        // shape we didn't anticipate, the OUTER catch used to discard the
        // ENTIRE context -- including activePanel -- which meant Kadessa lost
        // track of even being in Diagrams & Graphs at all, and (since
        // captureVisionSnapshot bails out on a null context) the chart
        // screenshot silently stopped being sent too. Now a failure here
        // still falls through to a minimal but valid context below, so
        // Kadessa at minimum always knows what panel she's in and gets the
        // chart image, even if the extra column/type details couldn't be
        // computed this turn.
        try {
          // The chart-so-far (chartType/rows) only tells Kadessa what's CURRENTLY plotted.
          // If the user asks for a diagram of columns that aren't the current X/Y pick
          // (e.g. "customers vs unit price" while a Date/Quantity chart is showing),
          // Kadessa needs the full source-table column list -- with types -- to know
          // those columns exist at all and which colIdx to hand dg_set_x_axis /
          // dg_set_y_axis. dgUploadParsed holds that raw table once anything's been
          // pasted/uploaded into this module; expose it (trimmed) alongside the
          // current chart state rather than only the current chart state.
          let availableColumns = [];
          if (typeof dgUploadParsed !== 'undefined' && dgUploadParsed && Array.isArray(dgUploadParsed.headers)){
            availableColumns = dgUploadParsed.headers.map(function(h, i){
              let kind = 'text';
              try {
                if (dgColumnIsDate(i)) kind = 'date';
                else if (dgColumnIsNumeric(i)) kind = 'numeric';
                else if (dgIsIdentifierColumn(i)) kind = 'identifier';
              } catch(e){ /* leave as text if a detector throws on odd data */ }
              return { colIdx: i, name: h, kind: kind };
            });
          }

          const base = {
            activePanel: 'Diagrams & Graphs',
            availableColumns: availableColumns.slice(0, 40),
            chartTypeGuidance: 'availableColumns lists every column in the source table the user pasted/uploaded here, with its detected kind (text/numeric/date/identifier). The user will often name a field by abbreviation, business jargon, or a rough paraphrase rather than the exact header text -- e.g. "CAC" for a column literally named "Customer Acquisition Cost", "rev" for "Revenue", "qty" for "Quantity". Resolve by MEANING, not literal string closeness: read each available column name for what it represents and pick the one the user\'s term most plausibly refers to. If exactly one column is a confident semantic match for each side of the request, call dg_set_x_axis/dg_set_y_axis with those colIdx values, then dg_set_type. Suggested type defaults: categorical or identifier X + numeric Y -> bar; date X + numeric Y -> line; numeric X + numeric Y -> scatter; more than one Y column selected -> grouped bar. If a named field has no plausible match in availableColumns at all, or if two+ columns could equally be what they mean (e.g. both "Cost" and "Cost per Unit" could be "cst"), do NOT guess -- name the columns you considered and ask which one in a short reply instead of calling an action. Only fall back to the currently-plotted chartType/rows below if the user\'s request doesn\'t clearly name different columns.'
          };

          if (dgState.type === 'grouped'){
            return Object.assign(base, {
              chartType: 'grouped bar',
              categories: (dgState.groupedCategories || []).slice(0, 30),
              series: (dgState.groupedSeries || []).slice(0, 10).map(function(s){
                return { name: s.name, values: (s.values || []).slice(0, 30) };
              })
            });
          }
          return Object.assign(base, {
            chartType: dgState.type,
            rows: (dgState.rows || []).slice(0, 30).map(function(r){
              return { label: r.label, value: r.value };
            }),
            rowCount: (dgState.rows || []).length
          });
        } catch(e){
          console.warn('getKadessaContext: Diagrams detail-gathering failed, falling back to minimal context', e);
          return { activePanel: 'Diagrams & Graphs', chartType: (dgState && dgState.type) || null };
        }
      }


      return null;
    } catch(e){ return null; }
  }

  // ── KADESSA ACTIONS ──────────────────────────────────────────────────────
  // "do it for me" powers. Every entry dispatches straight to an existing,
  // already-tested module function -- Kadessa never gets a separate code path
  // that mutates state on its own. That means every action here inherits
  // that module's existing undo/redo + Yjs collab sync for free.
  //
  // risk: 'safe' runs immediately. 'confirm' shows the existing app-wide
  // confirm modal (sarvarcModalConfirm) first and only runs if the user
  // taps through. Redaction has no entries here at all, on purpose --
  // it's the one module Kadessa doesn't get to touch yet.
  // ═══════════════════════════════════════════════════════════════════════
  // DIAGRAMS & GRAPHS HANDS (Kadessa v57). Every function here calls an existing, already-tested
  // dg* function, so undo/redo, persistence, history and collab sync come for free.
  // ═══════════════════════════════════════════════════════════════════════
  var KDG_GROUPED = ['grouped', 'hstacked', 'tornado', '3d-grouped-bar'];

  function kdgEnsureSection(){
    if (typeof unifiedActiveSection === 'function' && typeof navigate === 'function' && unifiedActiveSection() !== 'diagrams') navigate('diagrams');
  }
  function kdgEnsureMode(mode){
    if (typeof dgActiveMode !== 'undefined' && dgActiveMode !== mode) dgSetDgMode(mode);
  }
  function kdgTypeNeedsSeries(t){ return KDG_GROUPED.indexOf(t) !== -1; }
  function kdgTypeLabel(t){
    return ({ grouped: 'grouped bar', hstacked: 'horizontal stacked bar', tornado: 'tornado', '3d-grouped-bar': '3D grouped bar',
      '3d-bar': '3D bar', '3d-histogram': '3D histogram', '3d-scatter': '3D scatter', '3d-boxplot': '3D box plot' })[t] || t;
  }

  // Safe type switch: refuses a switch the data cannot support instead of showing an empty canvas.
  function kdgSetType(t){
    if (!t) return null;
    kdgEnsureSection(); kdgEnsureMode('chart');
    if (kdgTypeNeedsSeries(t) && !(dgState.groupedSeries && dgState.groupedSeries.length > 1)) {
      return { say: 'A ' + kdgTypeLabel(t) + ' chart needs two or more series (for example 2025 and 2026 per month), and this chart has one. Give me the second set of numbers and I will build it.' };
    }
    if (t === 'tornado' && dgState.groupedSeries && dgState.groupedSeries.length !== 2) {
      return { say: 'A tornado chart compares exactly two series, and this chart has ' + dgState.groupedSeries.length + '. Tell me which two to compare.' };
    }
    dgSetType(t);
    return null;
  }

  // Style settings shared by dg_build_chart, dg_style_chart and dg_build_map. Returns lines for things that do not apply.
  function kdgApplyStyle(p, notes){
    var el;
    if (p.title !== undefined){ el = document.getElementById('dgTitleInput'); if (el) el.value = p.title; }
    if (p.x_axis_title !== undefined){ el = document.getElementById('dgXAxisTitleInput'); if (el) el.value = p.x_axis_title; }
    if (p.y_axis_title !== undefined){ el = document.getElementById('dgYAxisTitleInput'); if (el) el.value = p.y_axis_title; }
    if (p.currency_symbol) dgState.currencySymbol = p.currency_symbol;
    if (p.number_format){
      el = document.getElementById('dgFormatSelect');
      if (el) el.value = p.number_format; // 'plain' has no option, which selects "" = the plain default, same as the templates
      dgState.formatUserSet = true;
      if (typeof dgSyncFormatUI === 'function') dgSyncFormatUI();
    }
    var t = dgState.type;
    function chip(inputId, chipId, on){
      var cb = document.getElementById(inputId); if (!cb) return;
      cb.checked = !!on;
      var c = document.getElementById(chipId); if (c) c.classList.toggle('active', !!on);
    }
    if (p.show_legend !== undefined) chip('dgLegendToggle', 'dgLegendChip', p.show_legend);
    if (p.show_values !== undefined) chip('dgValuesToggle', 'dgValuesChip', p.show_values);
    if (p.trendline !== undefined){
      if (p.trendline && DG_TREND_TYPES.indexOf(t) === -1) notes.push('a trendline does not apply to a ' + kdgTypeLabel(t) + ' chart');
      else chip('dgTrendlineToggle', 'dgTrendChip', p.trendline);
    }
    if (p.growth_mode !== undefined){
      if (p.growth_mode && DG_GROWTH_TYPES.indexOf(t) === -1) notes.push('growth mode only works on bar, line and area charts');
      else chip('dgGrowthToggle', 'dgGrowthChip', p.growth_mode);
    }
    if (p.hologram !== undefined){
      if (p.hologram && !dgIs3DType(t)) notes.push('the hologram look only applies to the 3D chart types');
      else chip('dgHologramToggle', 'dgHologramChip', p.hologram);
    }
    if (p.palette){
      el = document.getElementById('dgSchemeSelect'); if (el) el.value = p.palette;
      dgSetPaletteScheme(p.palette);
    }
    if (p.bar_radius !== undefined){
      if (DG_RADIUS_TYPES.indexOf(t) === -1) notes.push('rounded corners only apply to bar style charts');
      else dgOnBarRadiusInput(p.bar_radius);
    }
    if (p.same_color){
      el = document.getElementById('dgSameColorInput'); if (el) el.value = p.same_color;
      dgState.sameColor = p.same_color;
      el = document.getElementById('dgSameColorToggle'); if (el) el.checked = true;
      dgToggleSameColor(true);
    }
  }

  function kdgSay(notes, built){
    if (!notes.length) return built ? { say: built } : null;
    return { say: (built ? built + ' ' : '') + 'Heads up: ' + notes.join('; ') + '.' };
  }

  function kdgBuildChart(p){
    kdgEnsureSection(); kdgEnsureMode('chart');
    var type = p.chart_type || 'bar';
    var grouped = kdgTypeNeedsSeries(type);
    if (grouped && !(p.categories && p.categories.length && p.series && p.series.length)) throw new Error('a ' + kdgTypeLabel(type) + ' chart needs categories and series');
    if (!grouped && !(p.rows && p.rows.length)) throw new Error('no data points to draw');
    // palette first, so colours below come from it
    if (p.palette){
      var sel = document.getElementById('dgSchemeSelect'); if (sel) sel.value = p.palette;
      dgState.paletteScheme = p.palette;
      try { dgRenderPalette(); } catch (e) {}
    }
    var scheme = dgCurrentScheme();
    dgState.sameColorMode = false;
    var sameBox = document.getElementById('dgSameColorToggle'); if (sameBox) sameBox.checked = false;
    if (grouped){
      dgState.groupedCategories = p.categories.slice();
      dgState.groupedSeries = p.series.map(function(s, i){ return { name: s.name, color: s.color || scheme[i % scheme.length], values: s.values.slice() }; });
      dgState.rows = p.categories.map(function(c, i){ return { label: c, value: Number(p.series[0].values[i]) || 0, color: scheme[i % scheme.length] }; });
    } else {
      dgState.rows = p.rows.map(function(r, i){ return { label: r.label, value: r.value, color: r.color || scheme[i % scheme.length] }; });
      dgState.groupedCategories = []; dgState.groupedSeries = [];
    }
    dgState.texts = []; // a rebuilt chart starts without the old chart's notes
    dgSetType(type);
    var notes = [];
    var style = Object.assign({}, p);
    delete style.palette; // already applied above
    if (style.title === undefined) style.title = ''; // never keep the previous chart's title on a new chart
    if (style.number_format === undefined){
      dgState.formatUserSet = false;
      var fs = document.getElementById('dgFormatSelect'); if (fs) fs.value = 'plain';
      if (typeof dgSyncFormatUI === 'function') dgSyncFormatUI();
    }
    kdgApplyStyle(style, notes);
    dgRenderRows();
    dgRender();
    return kdgSay(notes, null);
  }

  function kdgStyleChart(p){
    kdgEnsureSection(); kdgEnsureMode('chart');
    var notes = [];
    kdgApplyStyle(p, notes);
    dgRender();
    return kdgSay(notes, null);
  }

  function kdgEditRows(p){
    kdgEnsureSection(); kdgEnsureMode('chart');
    if (dgUsesGroupedData()) return { say: 'This is a multi series chart. Send me the full set of numbers and I will rebuild it with the change.' };
    var rows = dgState.rows, scheme = dgCurrentScheme(), missing = [];
    function find(label){
      var l = String(label || '').toLowerCase();
      var i = rows.findIndex(function(r){ return String(r.label).toLowerCase() === l; });
      if (i === -1) i = rows.findIndex(function(r){ return String(r.label).toLowerCase().indexOf(l) !== -1 && l; });
      return i;
    }
    (p.ops || []).forEach(function(o){
      if (o.op === 'add'){
        var i = rows.length;
        rows.push({ label: o.label, value: o.value !== undefined ? o.value : 0, color: o.color || (dgState.sameColorMode ? dgState.sameColor : scheme[i % scheme.length]) });
      } else if (o.op === 'update'){
        var k = find(o.label);
        if (k === -1){ missing.push(o.label); return; }
        if (o.new_label) rows[k].label = o.new_label;
        if (o.value !== undefined) rows[k].value = o.value;
        if (o.color && !dgState.sameColorMode) rows[k].color = o.color;
      } else if (o.op === 'remove'){
        var j = find(o.label);
        if (j === -1){ missing.push(o.label); return; }
        rows.splice(j, 1);
      } else if (o.op === 'sort'){
        var dir = o.order === 'asc' ? 1 : -1;
        if (o.by === 'label') rows.sort(function(a, b){ return dir * String(a.label).localeCompare(String(b.label)); });
        else rows.sort(function(a, b){ return dir * (a.value - b.value); });
      } else if (o.op === 'top_n'){
        rows.sort(function(a, b){ return b.value - a.value; });
        rows.splice(o.n);
      }
    });
    if (!rows.length) throw new Error('that would leave the chart with no data points');
    dgRenderRows();
    dgRefreshChart();
    if (missing.length) return { say: 'I could not find ' + missing.map(function(m){ return '"' + m + '"'; }).join(', ') + ' on the chart. The labels are: ' + rows.slice(0, 12).map(function(r){ return r.label; }).join(', ') + '.' };
    return null;
  }

  function kdgAddText(p){
    kdgEnsureSection(); kdgEnsureMode('chart');
    var fs = p.font_size || 20, txt = p.text || 'Text';
    var pos = dgFindSmartTextPosition(Math.max(60, txt.length * fs * 0.6), fs * 1.4);
    dgState.texts.push({ id: 'dgtxt_' + (++dgTextSeq), text: txt, x: pos.x, y: pos.y, fontSize: fs, color: p.color || '#101820', bold: p.bold !== false, align: 'left', fontFamily: 'Inter' });
    dgRenderTextOverlay();
    dgPersist();
  }

  async function kdgBuildDiagram(p){
    if (!p.mermaid_code) throw new Error('no diagram code to draw');
    kdgEnsureSection();
    dgSetDgMode('flow');
    var ta = document.getElementById('dgFlowInput'), ti = document.getElementById('dgFlowTitleInput');
    if (!ta) throw new Error('the diagram box is not available');
    ta.value = p.mermaid_code;
    if (ti) ti.value = p.title || 'Diagram';
    await dgFlowRender();
    var err = document.getElementById('dgFlowError');
    if (err && err.style.display !== 'none' && err.textContent){
      return { say: 'The diagram came out with an error (' + err.textContent.replace(/^Syntax error:\s*/, '').slice(0, 140) + '). Say "fix it" and I will redraw it with simpler wording.' };
    }
    return null;
  }

  function kdgBuildMap(p){
    if (!p.rows || !p.rows.length) throw new Error('no countries to shade');
    kdgEnsureSection();
    dgSetDgMode('map');
    if (p.palette){
      var sel = document.getElementById('dgSchemeSelect'); if (sel) sel.value = p.palette;
      dgState.paletteScheme = p.palette;
      try { dgRenderPalette(); } catch (e) {}
    }
    var scheme = dgCurrentScheme();
    dgState.groupedCategories = []; dgState.groupedSeries = [];
    dgState.rows = p.rows.map(function(r){ return { label: r.country, value: r.value, color: scheme[0] }; });
    var notes = [];
    var style = { title: p.title || '', number_format: p.number_format, currency_symbol: p.currency_symbol };
    if (!style.number_format){ dgState.formatUserSet = false; delete style.number_format; }
    if (!style.currency_symbol) delete style.currency_symbol;
    kdgApplyStyle(style, notes);
    dgRenderRows();
    dgRender();
    var countryHits = dgState.rows.filter(function(r){ return dgResolveCountry(r.label); }).length;
    var stateGuess = null;
    try { stateGuess = dgDetectStatesCountry(dgState.rows); } catch (e) {}
    if (stateGuess && stateGuess.matched > countryHits){
      try { dgAutoShowStateMap(stateGuess.country); } catch (e) {}
      return { say: 'These look like ' + stateGuess.country + ' states, so I opened the ' + stateGuess.country + ' state map.' };
    }
    var unknown = dgState.rows.filter(function(r){ return !dgResolveCountry(r.label); }).map(function(r){ return r.label; });
    if (unknown.length) return { say: 'I could not match ' + unknown.slice(0, 6).join(', ') + (unknown.length > 6 ? ' and ' + (unknown.length - 6) + ' more' : '') + ' to a country, so they are not shaded. English country names work best.' };
    return null;
  }


  // Chart straight from the open Data Arrangement table, by column NAME, on the whole table (or only the filtered rows).
  // One step: no "send to Diagrams" popup, no index guessing, no chain of calls that can stall halfway.
  function kdgFindCol(headers, want){
    var w = String(want == null ? '' : want).trim().toLowerCase();
    if (!w) return -1;
    var i = headers.findIndex(function(h){ return String(h).trim().toLowerCase() === w; });
    if (i === -1) i = headers.findIndex(function(h){ var s = String(h).toLowerCase(); return s.indexOf(w) !== -1 || (s.length > 2 && w.indexOf(s) !== -1); });
    if (i === -1 && /^\d+$/.test(w) && Number(w) < headers.length) i = Number(w);
    return i;
  }
  function kdgChartFromTable(p){
    var ds = (typeof daGetActive === 'function') ? daGetActive() : null;
    if (!ds || !ds.headers || !ds.headers.length) throw new Error('there is no table open to chart');
    var xi = kdgFindCol(ds.headers, p.x_column);
    var yis = (p.y_columns || []).map(function(n){ return kdgFindCol(ds.headers, n); });
    if (xi === -1) throw new Error('I could not find a column called "' + p.x_column + '". The columns are: ' + ds.headers.slice(0, 15).join(', '));
    var bad = (p.y_columns || []).filter(function(n, k){ return yis[k] === -1; });
    if (bad.length) throw new Error('I could not find ' + bad.map(function(b){ return '"' + b + '"'; }).join(', ') + '. The columns are: ' + ds.headers.slice(0, 15).join(', '));
    yis = yis.filter(function(v, k){ return v !== xi && yis.indexOf(v) === k; });
    if (!yis.length) throw new Error('pick at least one value column that is different from the label column');
    var all = daComputedRowsForExport(ds);
    var keep = (p.filtered_only === true && typeof kadessaFilteredRowIdxs === 'function') ? kadessaFilteredRowIdxs(ds) : null;
    if (keep) all = keep.map(function(ri){ return all[ri]; });
    var cols = [xi].concat(yis);
    var prof = kadessaProfileColumns(ds);
    var aggMode = String(p.aggregate || 'auto').toLowerCase();
    var xKind = prof[xi] && prof[xi].kind;
    var xKeys = {}, repeated = false;
    all.forEach(function(r){ var k = String(r[xi]).trim(); if (xKeys[k]) repeated = true; xKeys[k] = 1; });
    var aoa;
    if (aggMode !== 'none' && (repeated || aggMode === 'count')){
      var groups = {}, order = [];
      var bucketMonth = (xKind === 'date' && Object.keys(xKeys).length > 31);
      all.forEach(function(r){
        var k = String(r[xi]).trim();
        if (bucketMonth){ var d = new Date(k); if (!isNaN(d)) k = d.toLocaleString('en-US', { month: 'short', year: 'numeric' }); }
        if (!groups[k]){ groups[k] = { n: 0, t: yis.map(function(){ return { sum: 0, n: 0 }; }), ts: (new Date(String(r[xi]).trim())).getTime() }; order.push(k); }
        var g = groups[k]; g.n++;
        yis.forEach(function(c, j){ var v = daFilterNum(r[c]); if (!isNaN(v)){ g.t[j].sum += v; g.t[j].n++; } });
      });
      if (xKind === 'date') order.sort(function(a, b){ return (groups[a].ts || 0) - (groups[b].ts || 0); });
      var how = yis.map(function(c){
        if (aggMode === 'sum' || aggMode === 'average' || aggMode === 'count') return aggMode;
        return (prof[c] && prof[c].combine) || 'sum';
      });
      var body = order.map(function(k){
        var g = groups[k];
        return [k].concat(yis.map(function(c, j){
          if (how[j] === 'count') return g.n;
          if (how[j] === 'average') return g.t[j].n ? Math.round((g.t[j].sum / g.t[j].n) * 100) / 100 : 0;
          return Math.round(g.t[j].sum * 100) / 100;
        }));
      });
      // Category charts read best biggest first. Dates keep their order.
      if (xKind !== 'date' && yis.length === 1) body.sort(function(a, b){ return b[1] - a[1]; });
      var hdrs = [ds.headers[xi]].concat(yis.map(function(c, j){
        return how[j] === 'count' ? 'Number of rows' : (how[j] === 'average' ? 'Average ' : 'Total ') + ds.headers[c];
      }));
      aoa = [hdrs].concat(body);
      p.__aggNote = 'Grouped ' + all.length + ' rows into ' + body.length + ' ' + (bucketMonth ? 'months' : 'groups') + ' (' + how.join(', ') + ').';
    } else {
      aoa = [cols.map(function(c){ return ds.headers[c]; })].concat(all.map(function(r){ return cols.map(function(c){ return r[c]; }); }));
    }
    // Money columns get their own symbol, counts stay plain, so Units Sold is never shown as dollars.
    if (!p.number_format){
      var money = yis.map(function(c){ return prof[c] && prof[c].currency; }).filter(Boolean);
      if (money.length === yis.length && money.length){ p.number_format = 'currency'; if (!p.currency_symbol) p.currency_symbol = money[0]; }
      else if (!money.length) p.number_format = 'plain';
    }
    kdgEnsureSection(); kdgEnsureMode('chart');
    var t = document.getElementById('dgTitleInput'); if (t) t.value = '';
    dgOnUploadParsed(aoa, ds.name || 'Table data');
    // Several value columns become a grouped chart on their own. A single one honours the type asked for.
    var type = p.chart_type, notes = [];
    if (type){
      var r = kdgSetType(type);
      if (r && r.say) notes.push(r.say);
    }
    var style = Object.assign({}, p); delete style.x_column; delete style.y_columns; delete style.chart_type; delete style.filtered_only; delete style.aggregate; delete style.__aggNote;
    kdgApplyStyle(style, notes);
    dgRender();
    // dgMaybeSuggestMultiChart may have opened its "how do you want this charted" popup, the person already told us.
    try { if (typeof dgDismissMultiSuggest === 'function') dgDismissMultiSuggest(); } catch (e) {}
    if (typeof dgSaveCurrentToHistory === 'function') dgSaveCurrentToHistory();
    var plotted = (dgState.rows || []).length;
    var capNote = (dgUploadParsed && dgUploadParsed.rows && dgUploadParsed.rows.length > 40) ? 'The table has ' + dgUploadParsed.rows.length + ' rows, so the chart shows the first 40 to stay readable.' : '';
    var msg = [p.__aggNote, capNote].concat(notes).filter(Boolean).join(' ');
    return msg ? { say: msg } : null;
  }

  function kdgRound(n){ return (typeof n === 'number' && isFinite(n)) ? Math.round(n * 100) / 100 : n; }

  // What Kadessa can see about the Diagrams & Graphs panel, so she can describe, critique and edit it.
  function kdgSnapshot(){
    var val = function(id){ var e = document.getElementById(id); return e ? e.value : ''; };
    var chk = function(id){ var e = document.getElementById(id); return !!(e && e.checked); };
    var snap = {
      mode: (typeof dgActiveMode !== 'undefined') ? dgActiveMode : 'chart',
      type: dgState.type,
      title: val('dgTitleInput'), xAxisTitle: val('dgXAxisTitleInput'), yAxisTitle: val('dgYAxisTitleInput'),
      numberFormat: val('dgFormatSelect') || 'plain', currencySymbol: dgState.currencySymbol,
      palette: dgState.paletteScheme, barRadius: dgState.barRadius,
      toggles: { legend: chk('dgLegendToggle'), values: chk('dgValuesToggle'), trendline: chk('dgTrendlineToggle'), growth: chk('dgGrowthToggle'), hologram: chk('dgHologramToggle') },
      notesOnChart: (dgState.texts || []).slice(0, 8).map(function(t){ return t.text; }),
      supportedChartTypes: ['bar', 'grouped', 'line', 'area', 'pie', 'donut', 'stacked', 'hstacked', 'tornado', 'waterfall', 'pareto', 'funnel', '3d-bar', '3d-grouped-bar', '3d-histogram', '3d-scatter', '3d-boxplot']
    };
    try {
      if (snap.mode === 'flow'){
        var code = val('dgFlowInput');
        var err = document.getElementById('dgFlowError');
        snap.flow = { title: val('dgFlowTitleInput'), code: code.slice(0, 3500), codeTruncated: code.length > 3500, error: (err && err.style.display !== 'none') ? err.textContent : '' };
        return snap;
      }
      if (dgUsesGroupedData() && dgState.groupedSeries && dgState.groupedSeries.length){
        snap.categories = dgState.groupedCategories.slice(0, 30);
        snap.series = dgState.groupedSeries.slice(0, 8).map(function(s){
          var tot = s.values.reduce(function(a, b){ return a + (Number(b) || 0); }, 0);
          return { name: s.name, values: s.values.slice(0, 30), total: kdgRound(tot) };
        });
        return snap;
      }
      var rows = (dgState.rows || []).filter(function(r){ return typeof r.value === 'number' && isFinite(r.value); });
      snap.rowCount = rows.length;
      snap.rows = rows.slice(0, 40).map(function(r){ return { label: r.label, value: r.value }; });
      if (rows.length){
        var st = dgComputeStats(rows);
        snap.stats = {
          total: kdgRound(st.total), average: kdgRound(st.avg),
          highest: { label: st.maxLabel, value: kdgRound(st.max) }, lowest: { label: st.minLabel, value: kdgRound(st.min) },
          trend: st.trend, growthPercentFirstToLast: st.growthPct == null ? null : kdgRound(st.growthPct),
          topItemShareOfTotal: st.topShare == null ? null : kdgRound(st.topShare),
          itemsThatMakeUp80Percent: st.vitalFewCount,
          outliers: (st.outliers || []).slice(0, 5).map(function(o){ return o && o.label !== undefined ? o.label : String(o); })
        };
      }
    } catch (e) { snap.snapshotError = String(e && e.message || e).slice(0, 120); }
    return snap;
  }


  // ── Build 301: data-type awareness ──────────────────────────────────────
  // Classifies every column of a table (date / category / id / measure / text) so Kadessa can pick a chart that fits.
  var KDG_NONADD = /price|rate|score|rating|margin|percent|%|average|avg|age\b|discount|ratio|share/i;
  function kdgCurrencyOf(h, vals){
    var m = String(h || '').match(/[₹$€£¥]/); if (m) return m[0];
    for (var i = 0; i < vals.length && i < 40; i++){ var q = String(vals[i]).match(/[₹$€£¥]/); if (q) return q[0]; }
    return '';
  }
  function kdgIsDateStr(v){
    var t = String(v).trim();
    if (!t || /^\d+(\.\d+)?$/.test(t)) return false;
    if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/.test(t) || /^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}$/.test(t)) return true;
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ -,]*(\d{1,2}[ ,-]*)?\d{2,4}$/i.test(t)) return true;
    return false;
  }
  function kadessaProfileColumns(ds){
    var rows = ds.rows || [];
    return (ds.headers || []).map(function(h, ci){
      var vals = [], nums = [], dates = 0, uniq = {};
      for (var ri = 0; ri < rows.length; ri++){
        var v = rows[ri][ci];
        if (typeof v === 'string' && v.trim().charAt(0) === '=' && typeof daFormulaDisplayValue === 'function') v = daFormulaDisplayValue(ds, ri, ci).display;
        if (v === '' || v === null || v === undefined) continue;
        vals.push(v);
        var n = daFilterNum(v);
        if (!isNaN(n) && String(v).trim() !== '') nums.push(n);
        if (kdgIsDateStr(v)) dates++;
        uniq[String(v).trim()] = 1;
      }
      var cnt = vals.length, distinct = Object.keys(uniq).length;
      var col = { header: h, colIdx: ci, distinct: distinct, filled: cnt };
      if (!cnt){ col.kind = 'empty'; return col; }
      if (dates / cnt > 0.7) col.kind = 'date';
      else if (nums.length / cnt > 0.7){
        col.kind = 'measure';
        col.combine = KDG_NONADD.test(String(h)) ? 'average' : 'sum';
        col.min = Math.min.apply(null, nums); col.max = Math.max.apply(null, nums);
        var cur = kdgCurrencyOf(h, vals); if (cur) col.currency = cur;
        var isInt = nums.every(function(x){ return Math.round(x) === x; });
        if (!cur && isInt) col.looksLikeCount = true;
        if (/(^|\W)(id|no|number|code|sku)(\W|$)/i.test(String(h)) && distinct === cnt){ col.kind = 'identifier'; delete col.combine; }
      } else {
        if (/(^|\W)(id|no|number|code|sku|email)(\W|$)/i.test(String(h)) || (distinct === cnt && cnt > 8)) col.kind = 'identifier';
        else if (distinct <= Math.max(12, Math.round(cnt * 0.3))) col.kind = 'category';
        else col.kind = 'text';
      }
      return col;
    });
  }

  function kadessaDgDecorate(c){
    try {
      if (!c || typeof c !== 'object') return c;
      c.dgHands = true; // tells the Worker this client has the Diagrams & Graphs hands
      try { var dsT = (typeof daGetActive === 'function') ? daGetActive() : null; if (dsT && dsT.headers && dsT.headers.length) c.openTable = { name: dsT.name, rowCount: (dsT.rows || []).length, columns: kadessaProfileColumns(dsT).slice(0, 30) }; } catch (e) {}
      if (c.activePanel === 'Diagrams & Graphs') c.diagram = kdgSnapshot();
      if (c.activePanel === 'Data Arrangement' && typeof daSelection !== 'undefined' && typeof daGetActive === 'function'){
        var dsx = daGetActive(), sel = [];
        if (dsx && daSelection.cols && daSelection.cols.size){
          Array.from(daSelection.cols).sort(function(a, b){ return a - b; }).forEach(function(ci){ if (dsx.headers[ci] !== undefined) sel.push(dsx.headers[ci]); });
        }
        if (dsx && daSelection.cellRanges && daSelection.cellRanges.length){
          daSelection.cellRanges.forEach(function(rg){
            var a = Math.min(rg.c1, rg.c2), b = Math.max(rg.c1, rg.c2);
            for (var ci = a; ci <= b; ci++){ var nm = dsx.headers[ci]; if (nm !== undefined && sel.indexOf(nm) === -1) sel.push(nm); }
          });
        }
        if (sel.length) c.selectedColumns = sel.slice(0, 10); // "these 2 columns" means these
      }
    } catch (e) { console.warn('[Kadessa] diagram snapshot failed', e); }
    return c;
  }

  function getKadessaContext(){ return kadessaDgDecorate(getKadessaContextBase()); }

  const KADESSA_ACTIONS = {
    da_add_row:        { risk: 'safe',    run: function(){ daEnsureVisible(); daAddRow(); }, label: function(){ return 'Add a new row.'; } },
    da_add_column:     { risk: 'safe',    run: function(){ daEnsureVisible(); daAddColumn(); }, label: function(){ return 'Add a new column.'; } },
    da_update_cell:    { risk: 'safe',    run: function(p){ daEnsureVisible(); daUpdateCell(p.rowIdx, p.colIdx, String(p.value)); }, label: function(p){ return 'Set cell (row ' + (p.rowIdx+1) + ', col ' + (p.colIdx+1) + ') to "' + p.value + '".'; } },
    da_delete_row:     { risk: 'confirm', run: function(p){ daEnsureVisible(); daDeleteRow(p.rowIdx); }, label: function(p){ return 'Delete row ' + (p.rowIdx+1) + '. This can be undone with Ctrl+Z.'; } },
    da_delete_column:  { risk: 'confirm', run: function(p){ daEnsureVisible(); daDeleteColumn(p.colIdx); }, label: function(p){ return 'Delete column ' + (p.colIdx+1) + '. This can be undone with Ctrl+Z.'; } },

    // Color-tag actions -- the same feature as the manual Highlight button
    // (see daSaveHighlightModal / daOpenHighlightModal above), just driven
    // by indices Kadessa works out from the conversation + context.headers
    // instead of a live row/column/cell drag-selection in the UI. All three
    // write straight into ds.rowHighlights/colHighlights/cellHighlights and
    // reuse daPersist + daRenderTable so a Kadessa-applied highlight looks and
    // syncs (Yjs) exactly like one applied by hand. color is a plain name
    // (yellow/green/blue/purple/red/gray) resolved via DA_HIGHLIGHT_COLOR_NAMES
    // rather than a hex code, so the model never has to guess a swatch value;
    // an unrecognized name quietly falls back to yellow rather than failing
    // the whole call over a color typo. tag is optional, shown in the
    // summary strip above the table, same as typing one into the modal.
    da_highlight_rows: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureHighlightStore(ds);
        const rowIdxs = Array.isArray(p.rowIdxs) ? p.rowIdxs : [];
        if (!rowIdxs.length) throw new Error('no rows given to highlight');
        const bad = rowIdxs.some(function(ri){ return ri < 0 || ri >= ds.rows.length; });
        if (bad) throw new Error('one of those row numbers is outside the table');
        const color = DA_HIGHLIGHT_COLOR_NAMES[String(p.color || 'yellow').toLowerCase()] || DA_HIGHLIGHT_COLOR_NAMES.yellow;
        const entry = { color: color, tag: p.tag || '' };
        rowIdxs.forEach(function(ri){ ds.rowHighlights[ri] = entry; });
        daPersist();
        daRenderTable();
      },
      label: function(p){
        const n = Array.isArray(p.rowIdxs) ? p.rowIdxs.length : 0;
        return 'Highlight ' + n + ' row' + (n === 1 ? '' : 's') + ' in ' + (p.color || 'yellow') + (p.tag ? ', tagged "' + p.tag + '"' : '') + '.';
      }
    },
    da_highlight_columns: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureHighlightStore(ds);
        const colIdxs = Array.isArray(p.colIdxs) ? p.colIdxs : [];
        if (!colIdxs.length) throw new Error('no columns given to highlight');
        const bad = colIdxs.some(function(ci){ return ci < 0 || ci >= ds.headers.length; });
        if (bad) throw new Error('one of those columns is outside the table');
        const color = DA_HIGHLIGHT_COLOR_NAMES[String(p.color || 'yellow').toLowerCase()] || DA_HIGHLIGHT_COLOR_NAMES.yellow;
        const entry = { color: color, tag: p.tag || '' };
        colIdxs.forEach(function(ci){ ds.colHighlights[ci] = entry; });
        daPersist();
        daRenderTable();
      },
      label: function(p){
        const n = Array.isArray(p.colIdxs) ? p.colIdxs.length : 0;
        return 'Highlight ' + n + ' column' + (n === 1 ? '' : 's') + ' in ' + (p.color || 'yellow') + (p.tag ? ', tagged "' + p.tag + '"' : '') + '.';
      }
    },
    // Individual cells, given as an explicit {rowIdx, colIdx} list rather
    // than a range -- this is the one shape the manual modal CAN'T do in a
    // single step for non-rectangular picks (e.g. "highlight row 2's Status
    // cell and row 9's Status cell"), so it's worth its own param shape
    // instead of forcing everything through a rectangular r1/c1/r2/c2 box.
    da_highlight_cells: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureHighlightStore(ds);
        const cells = Array.isArray(p.cells) ? p.cells : [];
        if (!cells.length) throw new Error('no cells given to highlight');
        const bad = cells.some(function(c){ return c.rowIdx < 0 || c.rowIdx >= ds.rows.length || c.colIdx < 0 || c.colIdx >= ds.headers.length; });
        if (bad) throw new Error('one of those cells is outside the table');
        const color = DA_HIGHLIGHT_COLOR_NAMES[String(p.color || 'yellow').toLowerCase()] || DA_HIGHLIGHT_COLOR_NAMES.yellow;
        const entry = { color: color, tag: p.tag || '' };
        cells.forEach(function(c){ ds.cellHighlights[c.rowIdx + '_' + c.colIdx] = entry; });
        daPersist();
        daRenderTable();
      },
      label: function(p){
        const n = Array.isArray(p.cells) ? p.cells.length : 0;
        return 'Highlight ' + n + ' cell' + (n === 1 ? '' : 's') + ' in ' + (p.color || 'yellow') + (p.tag ? ', tagged "' + p.tag + '"' : '') + '.';
      }
    },
    // The two actions above need Kadessa to already know the exact rows/cells
    // to hit -- fine for "highlight row 3" but useless for "mark important
    // values" on any table bigger than the ~15-row sample she's given in
    // getKadessaContext (see the dataarrange branch there). These two instead
    // take a RULE and get evaluated locally against ds.rows in full, so
    // Kadessa can act on a 500-row table exactly as well as a 5-row one --
    // she doesn't need to see every row, just decide the condition.
    //
    // Formula cells are compared by their COMPUTED display value (via
    // daFormulaDisplayValue), not the raw "=SUM(...)" text, so a rule like
    // "values over 10000" matches what the user actually sees in the cell.
    da_highlight_by_condition: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureHighlightStore(ds);
        const colIdx = Number(p.colIdx);
        if (!(colIdx >= 0 && colIdx < ds.headers.length)) throw new Error('that column is outside the table');
        const op = String(p.operator || '').toLowerCase();
        const color = DA_HIGHLIGHT_COLOR_NAMES[String(p.color || 'yellow').toLowerCase()] || DA_HIGHLIGHT_COLOR_NAMES.yellow;
        const entry = { color: color, tag: p.tag || '' };
        // Build 299: a rule match marks the WHOLE row unless scope is 'cell'.
        const wholeRow = String(p.scope || 'row').toLowerCase() !== 'cell';
        const isNumericOp = ['>', '>=', '<', '<='].includes(op);
        let hits = 0;
        ds.rows.forEach(function(row, ri){
          let cell = row[colIdx];
          if (typeof cell === 'string' && cell.trim().startsWith('=')) {
            cell = daFormulaDisplayValue(ds, ri, colIdx).display;
          }
          let matched = false;
          if (isNumericOp) {
            const num = daFilterNum(cell);
            if (!isNaN(num)) {
              let target = daFilterNum(String(p.value));
              if (isNaN(target)) target = Number(p.value);
              if (op === '>') matched = num > target;
              else if (op === '>=') matched = num >= target;
              else if (op === '<') matched = num < target;
              else if (op === '<=') matched = num <= target;
            }
          } else if (op === '==' || op === 'equals') {
            matched = String(cell ?? '').trim().toLowerCase() === String(p.value ?? '').trim().toLowerCase();
          } else if (op === '!=' || op === 'not_equals') {
            matched = String(cell ?? '').trim().toLowerCase() !== String(p.value ?? '').trim().toLowerCase();
          } else if (op === 'contains') {
            matched = String(cell ?? '').toLowerCase().includes(String(p.value ?? '').toLowerCase());
          } else if (op === 'empty') {
            matched = (cell === '' || cell === null || cell === undefined);
          } else if (op === 'not_empty') {
            matched = !(cell === '' || cell === null || cell === undefined);
          } else {
            throw new Error('"' + op + '" is not a comparison I understand');
          }
          if (matched) { if (wholeRow) ds.rowHighlights[ri] = entry; else ds.cellHighlights[ri + '_' + colIdx] = entry; hits++; }
        });
        if (!hits) throw new Error('nothing in that column matched');
        daPersist();
        daRenderTable();
      },
      label: function(p){
        return 'Highlight ' + (String(p.scope || 'row').toLowerCase() === 'cell' ? 'every cell' : 'every whole row') + ' where column ' + (p.colIdx + 1) + ' ' + p.operator + ' ' + p.value + ', in ' + (p.color || 'yellow') + '.';
      }
    },
    // "Mark the top 5 values" / "flag the 3 lowest" -- also a whole-column
    // scan, so it needs the same full-dataset pass rather than the sample.
    // Non-numeric cells in the column are simply skipped when ranking.
    da_highlight_top_bottom: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureHighlightStore(ds);
        const colIdx = Number(p.colIdx);
        if (!(colIdx >= 0 && colIdx < ds.headers.length)) throw new Error('that column is outside the table');
        const n = Math.max(1, Number(p.count) || 1);
        const which = (p.which === 'bottom') ? 'bottom' : 'top';
        const color = DA_HIGHLIGHT_COLOR_NAMES[String(p.color || 'yellow').toLowerCase()] || DA_HIGHLIGHT_COLOR_NAMES.yellow;
        const entry = { color: color, tag: p.tag || '' };
        const wholeRow = String(p.scope || 'row').toLowerCase() !== 'cell';
        const scored = [];
        ds.rows.forEach(function(row, ri){
          let cell = row[colIdx];
          if (typeof cell === 'string' && cell.trim().startsWith('=')) {
            cell = daFormulaDisplayValue(ds, ri, colIdx).display;
          }
          const num = daFilterNum(cell);
          if (!isNaN(num)) scored.push({ ri: ri, num: num });
        });
        if (!scored.length) throw new Error('that column has no numeric values to rank');
        scored.sort(function(a, b){ return which === 'top' ? b.num - a.num : a.num - b.num; });
        scored.slice(0, n).forEach(function(s){ if (wholeRow) ds.rowHighlights[s.ri] = entry; else ds.cellHighlights[s.ri + '_' + colIdx] = entry; });
        daPersist();
        daRenderTable();
      },
      label: function(p){
        return 'Highlight the ' + (Math.max(1, Number(p.count) || 1)) + ' ' + (p.which === 'bottom' ? 'lowest' : 'highest') + ' value' + (Number(p.count) === 1 ? '' : 's') + ' in column ' + (p.colIdx + 1) + ', in ' + (p.color || 'yellow') + '.';
      }
    },


    // shapes as the actions above, all in one call -- "remove the highlight
    // from row 3 and the Status column" is one tool call, not two.
    da_remove_highlight: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureHighlightStore(ds);
        (Array.isArray(p.rowIdxs) ? p.rowIdxs : []).forEach(function(ri){ delete ds.rowHighlights[ri]; });
        (Array.isArray(p.colIdxs) ? p.colIdxs : []).forEach(function(ci){ delete ds.colHighlights[ci]; });
        (Array.isArray(p.cells) ? p.cells : []).forEach(function(c){ delete ds.cellHighlights[c.rowIdx + '_' + c.colIdx]; });
        daPersist();
        daRenderTable();
      },
      label: function(p){
        const parts = [];
        const rowIdxs = Array.isArray(p.rowIdxs) ? p.rowIdxs : [];
        const colIdxs = Array.isArray(p.colIdxs) ? p.colIdxs : [];
        const cells = Array.isArray(p.cells) ? p.cells : [];
        if (rowIdxs.length) parts.push(rowIdxs.length + ' row' + (rowIdxs.length === 1 ? '' : 's'));
        if (colIdxs.length) parts.push(colIdxs.length + ' column' + (colIdxs.length === 1 ? '' : 's'));
        if (cells.length) parts.push(cells.length + ' cell' + (cells.length === 1 ? '' : 's'));
        return 'Remove the highlight from ' + (parts.join(', ') || 'the selection') + '.';
      }
    },

    // Drives the same per-person view filter as the manual Filter Rows
    // button/popover (daFilterState) -- it only hides rows in the grid,
    // nothing is deleted, and it isn't part of undo/redo, same as when a
    // person builds the filter by hand. Takes the WHOLE rule set in one
    // call (replacing whatever filter, if any, was already active) rather
    // than one rule per call, matching the same one-shot preference as
    // dg_configure_chart -- "show pending orders over 10000" is naturally
    // two conditions at once. context.activeFilter (see getKadessaContext's
    // dataarrange branch) shows Kadessa what's currently applied so she can
    // build on it ("also hide the empty rows") instead of guessing.
    //   operator: one of contains/notcontains/equals/notequals/starts/ends/
    //     gt/gte/lt/lte/between/oneof/empty/notempty (DA_FILTER_OPS keys).
    //   colIdx: 0-based column index, or '*' for "any column".
    //   value: required for every operator except empty/notempty.
    //   value2: required only for 'between' (the upper bound; order doesn't
    //     matter, the filter sorts the two itself). 'oneof' takes a single
    //     comma-separated value string, e.g. "Pending, Overdue".
    //   gt/gte/lt/lte/equals/between compare numerically when both sides
    //     parse as numbers (currency symbols, commas and Cr/Lakh/K/Mn/Bn
    //     suffixes are stripped first, same as the rest of Data
    //     Arrangement), then as dates (DD/MM/YYYY, YYYY-MM-DD, "12 Jan
    //     2024"), then as plain text -- so "amount > 50000" and "date after
    //     01/04/2024" both work without Kadessa needing to know the column's
    //     type in advance.
    da_set_filter: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        const rulesIn = Array.isArray(p.rules) ? p.rules : [];
        if (!rulesIn.length) throw new Error('no filter conditions given');
        const validOps = DA_FILTER_OPS.map(function(o){ return o[0]; });
        const rules = rulesIn.map(function(rr){
          const op = String(rr.operator || '').toLowerCase();
          if (validOps.indexOf(op) === -1) throw new Error('"' + rr.operator + '" is not a filter condition I understand');
          let col = rr.colIdx;
          if (col === '*' || col === undefined || col === null) col = '*';
          else {
            col = Number(col);
            if (!(col >= 0 && col < ds.headers.length)) throw new Error('column ' + (rr.colIdx) + ' is outside the table');
          }
          const needsVal = !DA_FILTER_OPS_NOVAL[op];
          if (needsVal && (rr.value === undefined || String(rr.value) === '')) throw new Error('the "' + op + '" condition needs a value');
          if (op === 'between' && (rr.value2 === undefined || String(rr.value2) === '')) throw new Error('"is between" needs both a from and a to value');
          return { col: col, op: op, val: needsVal ? String(rr.value) : '', val2: op === 'between' ? String(rr.value2) : undefined };
        });
        const st = daFilterGetState(ds);
        st.rules = rules;
        st.match = (p.match === 'any') ? 'any' : 'all';
        daPersist();
        daRenderTable();
      },
      label: function(p){
        const rules = Array.isArray(p.rules) ? p.rules : [];
        const n = rules.length;
        return 'Filter rows by ' + n + ' condition' + (n === 1 ? '' : 's') + (n > 1 ? ' (match ' + (p.match === 'any' ? 'any' : 'all') + ')' : '') + '.';
      }
    },
    da_clear_filter: {
      risk: 'safe',
      run: function(){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daFilterGetState(ds).rules = [];
        daPersist();
        daRenderTable();
      },
      label: function(){ return 'Clear the row filter.'; }
    },

    // Excel-style "Data Validation" pick-lists, driven by Kadessa. Mirrors
    // daSaveDropdownModal's own save logic exactly (dedupe, column-wide
    // list clears older single-cell overrides in that column) so a
    // Kadessa-set dropdown behaves identically to one set through the modal.
    // NOTE: these two entries were missing entirely until now -- the Worker
    // has offered this tool to Kadessa since v28, but with nothing here to
    // run it, every attempt surfaced as "I don't recognize that action yet".
    da_set_dropdown: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureDropdownStore(ds);
        const ci = p.colIdx;
        if (ci == null || ci < 0 || ci >= (ds.headers || []).length) throw new Error('column ' + ci + ' does not exist in this table');
        const options = Array.isArray(p.options)
          ? [...new Set(p.options.map(function(s){ return String(s).trim(); }).filter(function(s){ return s !== ''; }))]
          : [];
        if (!options.length) throw new Error('at least one option is needed');
        const colors = daAutoAssignDropdownColors(options);
        if (p.rowIdx !== undefined && p.rowIdx !== null) {
          const ri = p.rowIdx;
          if (ri < 0 || ri >= (ds.rows || []).length) throw new Error('row ' + ri + ' does not exist in this table');
          ds.cellDropdowns[ri + '_' + ci] = options;
          ds.cellDropdownColors[ri + '_' + ci] = colors;
        } else {
          ds.colDropdowns[ci] = options;
          ds.colDropdownColors[ci] = colors;
          // A column-wide list takes over, so any older single-cell
          // overrides in this column would just be confusing leftovers.
          Object.keys(ds.cellDropdowns).forEach(function(k){ if (k.endsWith('_' + ci)) delete ds.cellDropdowns[k]; });
          Object.keys(ds.cellDropdownColors).forEach(function(k){ if (k.endsWith('_' + ci)) delete ds.cellDropdownColors[k]; });
        }
        daPersist();
        daRenderTable();
      },
      label: function(p){
        const where = (p.rowIdx !== undefined && p.rowIdx !== null)
          ? ('cell ' + daColToLetters(p.colIdx) + (p.rowIdx + 1))
          : ('column ' + daColToLetters(p.colIdx));
        const opts = Array.isArray(p.options) ? p.options : [];
        return 'Add a dropdown to ' + where + ' with choices: ' + opts.slice(0, 6).join(', ') + (opts.length > 6 ? ', ...' : '') + '.';
      }
    },
    da_remove_dropdown: {
      risk: 'safe',
      run: function(p){
        daEnsureVisible();
        const ds = daGetActive(); if (!ds) throw new Error('no table is open');
        daEnsureDropdownStore(ds);
        const ci = p.colIdx;
        if (ci == null || ci < 0 || ci >= (ds.headers || []).length) throw new Error('column ' + ci + ' does not exist in this table');
        const ri = (p.rowIdx !== undefined && p.rowIdx !== null) ? p.rowIdx : -1;
        daRemoveDropdown(ri, ci);
      },
      label: function(p){
        return (p.rowIdx !== undefined && p.rowIdx !== null)
          ? 'Remove the dropdown from cell ' + daColToLetters(p.colIdx) + (p.rowIdx + 1) + '.'
          : 'Remove the dropdown from column ' + daColToLetters(p.colIdx) + '.';
      }
    },

    // Custom-columns table creation -- the Data Arrangement counterpart to
    // mf_create_form. Throws client-side (daCreateTableWithColumns) if no
    // usable column names come through, so an empty/garbled columns array
    // surfaces as a normal reply asking what columns are wanted, rather
    // than silently creating a table with no headers.
    da_create_table: {
      risk: 'safe',
      // FIX: dropdowns now flows through, so Kadessa can attach a pick-list to
      // an obviously-fixed-value column (Status, Priority, RSVP...) in the
      // SAME call that creates the table, rather than that column sitting
      // there as a plain text cell until a separate da_set_dropdown call
      // happens to follow. Each entry is { colIdx, options }, where colIdx
      // indexes into the `columns` array in THIS call. Bad entries are
      // skipped by daCreateTableWithColumns rather than failing table
      // creation.
      run: function(p){ daCreateTableWithColumns(p.name, p.columns, p.rows, p.dropdowns); },
      label: function(p){
        const cols = Array.isArray(p.columns) ? p.columns.filter(function(c){ return c && String(c).trim(); }) : [];
        const ddCount = Array.isArray(p.dropdowns) ? p.dropdowns.filter(function(d){ return d && Array.isArray(d.options) && d.options.length; }).length : 0;
        return 'Create a new table' + (p.name ? ' called "' + p.name + '"' : '') + (cols.length ? ' with ' + cols.length + ' column' + (cols.length === 1 ? '' : 's') + ' (' + cols.slice(0, 4).join(', ') + (cols.length > 4 ? ', ...' : '') + ')' : '') + (ddCount ? ', ' + ddCount + ' with dropdown' + (ddCount === 1 ? '' : 's') + ' attached' : '') + '.';
      }
    },
    // Template-based table creation, the counterpart to
    // mf_create_from_template above: reuses DA_TABLE_TEMPLATES so a
    // Kadessa-started "lead management" / "sales tracker" / etc. table always
    // gets the same real columns a person picking a template by hand would
    // see. Guards against an unknown/typo'd key the same way
    // mf_create_from_template guards its own `template` param.
    // da_link_tables {table, keyColumn, parentTable, parentKeyColumn?, pullColumns?: string[]}
    //   -- connects a CHILD table to a PARENT table by a shared key column
    //   (e.g. Deals.Client ID -> Clients.Client ID). Turns Interconnect
    //   tables ON, gives the key column a dropdown of valid parent keys,
    //   flags unknown keys, and adds pullColumns (parent columns, by header
    //   name) as live lookup columns. Create parent tables first.
    da_link_tables: {
      risk: 'safe',
      run: function(p){ daKadessaLinkTables(p); },
      label: function(p){ return 'Connect ' + (p.table || 'a table') + ' to ' + (p.parentTable || 'another table') + ' by ' + (p.keyColumn || 'a shared column'); }
    },
    da_create_table_from_template: {
      risk: 'safe',
      run: function(p){
        if (!p.table || !DA_TABLE_TEMPLATES[p.table]) throw new Error('unknown table template "' + p.table + '"');
        daCreateTableFromTemplate(p.table);
      },
      label: function(p){
        const tpl = DA_TABLE_TEMPLATES[p.table];
        return 'Create a new "' + (tpl ? tpl.name : p.table) + '" table' + (tpl ? ' with ' + tpl.columns.length + ' columns ready to fill in' : '') + '.';
      }
    },

    dg_set_type:       { risk: 'safe',    run: function(p){ return kdgSetType(p.chartType); }, label: function(p){ return 'Change chart type to ' + p.chartType + '.'; } },
    // One-shot version of "set X, set Y, set type" for building a whole new
    // chart from a request like "customer vs CAC" in a single turn, instead
    // of needing three separate actions (and three round-trips) to finish.
    // colIdx params are optional so Kadessa can still adjust just one axis
    // without having to already know the other.
    dg_configure_chart: {
      risk: 'safe',
      run: function(p){
        if (p.xColIdx !== undefined && p.xColIdx !== null && p.xColIdx !== '') dgQuickSetXAxis(String(p.xColIdx));
        if (p.yColIdx !== undefined && p.yColIdx !== null && p.yColIdx !== '') dgQuickSetYAxis(String(p.yColIdx));
        if (p.chartType) { var kr = kdgSetType(p.chartType); if (kr) return kr; }
      },
      label: function(p){
        const parts = [];
        if (p.xColIdx !== undefined && p.xColIdx !== '') parts.push('X-axis to column ' + p.xColIdx);
        if (p.yColIdx !== undefined && p.yColIdx !== '') parts.push('Y-axis to column ' + p.yColIdx);
        if (p.chartType) parts.push('chart type to ' + p.chartType);
        return 'Set ' + (parts.join(', ') || 'up the chart') + '.';
      }
    },
    dg_set_palette:    { risk: 'safe',    run: function(p){ dgSetPaletteScheme(p.scheme); }, label: function(p){ return 'Switch color palette to ' + p.scheme + '.'; } },
    dg_add_row:        { risk: 'safe',    run: function(){ dgAddRow(); }, label: function(){ return 'Add a new data row to the chart.'; } },
    dg_set_x_axis:     { risk: 'safe',    run: function(p){ dgQuickSetXAxis(String(p.colIdx)); }, label: function(p){ return 'Set the X-axis column.'; } },
    dg_set_y_axis:     { risk: 'safe',    run: function(p){ dgQuickSetYAxis(String(p.colIdx)); }, label: function(p){ return 'Set the Y-axis column.'; } },
    // ── Kadessa v57: Diagrams & Graphs hands ───────────────────────────
    dg_build_chart:    { risk: 'safe', run: function(p){ return kdgBuildChart(p); }, label: function(p){ return 'Build a ' + kdgTypeLabel(p.chart_type) + ' chart.'; } },
    dg_style_chart:    { risk: 'safe', run: function(p){ return kdgStyleChart(p); }, label: function(){ return 'Restyle the chart.'; } },
    dg_edit_rows:      { risk: 'safe', run: function(p){ return kdgEditRows(p); }, label: function(){ return 'Edit the chart data.'; } },
    dg_add_text:       { risk: 'safe', run: function(p){ return kdgAddText(p); }, label: function(p){ return 'Add a note to the chart.'; } },
    dg_load_template:  { risk: 'safe', run: function(p){ kdgEnsureSection(); kdgEnsureMode('chart'); if (!DG_TEMPLATES[p.template]) throw new Error('unknown sample chart'); dgApplyTemplate(p.template); }, label: function(p){ return 'Load a sample chart.'; } },
    dg_set_mode:       { risk: 'safe', run: function(p){ kdgEnsureSection(); dgSetDgMode(p.mode); }, label: function(p){ return 'Switch to ' + p.mode + ' mode.'; } },
    dg_build_diagram:  { risk: 'safe', run: function(p){ return kdgBuildDiagram(p); }, label: function(){ return 'Draw the diagram.'; } },
    dg_flow_template:  { risk: 'safe', run: function(p){ kdgEnsureSection(); dgSetDgMode('flow'); dgFlowInsertTemplate(p.template); }, label: function(){ return 'Load a diagram starter.'; } },
    dg_build_map:      { risk: 'safe', run: function(p){ return kdgBuildMap(p); }, label: function(){ return 'Build the map.'; } },
    dg_chart_from_table: { risk: 'safe', run: function(p){ return kdgChartFromTable(p); }, label: function(p){ return 'Chart ' + (p.y_columns || []).join(', ') + ' by ' + p.x_column + '.'; } },
    dg_export:         { risk: 'safe', run: function(p){ kdgEnsureSection(); dgExportChart(p.format === 'jpeg' ? 'jpeg' : 'png'); }, label: function(p){ return 'Download the chart as ' + String(p.format || 'png').toUpperCase() + '.'; } },

    // Previously there was NO way for Kadessa to start a brand-new form at
    // all -- mf_add_field/_update_title/etc. all silently no-op via
    // mfGetCurrentForm() returning undefined when mfState.currentId is
    // unset (no form open yet, e.g. a fresh "My Forms" gallery with 0
    // forms). That's why "create a registration form" would say "On it"
    // and then visibly do nothing: there was no active form for any of
    // the real mf_* actions to act on. This creates the blank form first
    // (mirroring the "New Form" button), then optionally sets its title/
    // description and adds every requested field with its real label and
    // required flag, all in the same action so the whole form appears in
    // one go instead of needing an add_field round trip per field.
    mf_create_form: {
      risk: 'safe',
      run: function(p){
        mfCreateFromTemplate('blank');
        const f = mfGetCurrentForm();
        if (!f) throw new Error('form did not open after creation');
        if (p.title) { f.title = p.title; }
        if (p.description) { f.desc = p.description; }
        if (Array.isArray(p.fields)){
          p.fields.forEach(function(spec){
            if (!spec || !spec.type) return;
            const field = mfNewField(spec.type);
            if (spec.label) field.label = spec.label;
            if (spec.required) field.required = true;
            f.fields.push(field);
          });
        }
        mfTouch(f);
        mfRenderFieldList();
        mfRenderPreview();
      },
      label: function(p){
        const n = Array.isArray(p.fields) ? p.fields.length : 0;
        return 'Create a new form' + (p.title ? ' called "' + p.title + '"' : '') + (n ? ' with ' + n + ' field' + (n === 1 ? '' : 's') : '') + '.';
      }
    },
    // Template-based creation, the counterpart to mf_create_form above:
    // reuses the exact same gallery function the "Browse Templates" cards
    // call (mfCreateFromTemplate), so a Kadessa-started template form is
    // identical to one a user picked by hand -- same fields, same
    // accent color, same opened editor. Guards against an unknown/typo'd
    // key rather than silently doing nothing, since MF_TEMPLATES is keyed
    // by camelCase ids the model has to get exactly right.
    mf_create_from_template: {
      risk: 'safe',
      run: function(p){
        if (!p.template || !MF_TEMPLATES[p.template]) throw new Error('unknown template "' + p.template + '"');
        mfCreateFromTemplate(p.template);
      },
      label: function(p){
        const tpl = MF_TEMPLATES[p.template];
        return 'Start a new form from the "' + (tpl ? tpl.name : p.template) + '" template.';
      }
    },
    // Publishing hits the real Supabase-backed publish flow (same code
    // path as the Publish button), so it needs an actual signed-in user
    // and a saved form -- mfPublishForm() already handles both cases
    // (not logged in / no form open) with its own toast, which surfaces
    // to the user as a normal Kadessa reply if run() throws.
    mf_publish_form: {
      risk: 'confirm',
      run: function(){ return mfPublishForm(); },
      label: function(){ return 'Publish this form and generate a shareable link.'; }
    },
    mf_add_field:      { risk: 'safe',    run: function(p){ mfAddField(p.type); }, label: function(p){ return 'Add a ' + p.type + ' field to the form.'; } },
    mf_update_title:   { risk: 'safe',    run: function(p){ mfUpdateTitle(p.title); }, label: function(p){ return 'Rename the form to "' + p.title + '".'; } },
    mf_update_description: { risk: 'safe', run: function(p){ mfUpdateDesc(p.description); }, label: function(p){ return 'Update the form description.'; } },
    // Sets one social/contact link shown as an icon row on the published
    // form. Guards against an unknown platform key the same way
    // mf_create_from_template guards against an unknown template, since a
    // typo'd key would otherwise silently do nothing (mfSetSocialLink has
    // no validation of its own). Passing an empty value clears that link.
    mf_set_social_link: {
      risk: 'safe',
      run: function(p){
        const validPlatforms = ['instagram', 'linkedin', 'whatsapp', 'x', 'youtube', 'website'];
        if (!p.platform || validPlatforms.indexOf(p.platform) === -1) throw new Error('unknown social platform "' + p.platform + '"');
        mfSetSocialLink(p.platform, p.value || '');
        mfRenderSocialLinks();
      },
      label: function(p){
        return (p.value ? 'Set' : 'Clear') + ' the form\'s ' + p.platform + ' link' + (p.value ? ' to "' + p.value + '"' : '') + '.';
      }
    },
    // Applies an image the person attached this turn as the form's logo
    // (centered watermark + auto-matched accent color) -- mirrors the
    // PDF Editor's pdfedSetRefineLogoFromFile flow, reading from
    // kadessaPendingAttachments (in scope here, see KADESSA ASSISTANT MODULE)
    // rather than asking the model to echo back raw image data as a param.
    mf_set_logo: {
      risk: 'safe',
      run: async function(){
        const entry = kadessaPendingAttachments.find(function(a){ return a.kind === 'logo'; });
        if (!entry) throw new Error('no image attached this turn to use as a logo');
        await mfSetLogoFromDataUrl(entry.dataUrl);
      },
      label: function(){ return 'Set the attached image as this form\'s logo.'; }
    },
    // Same attachment as above, applied as the faint full-width header
    // banner instead of the centered logo watermark -- Kadessa picks whichever
    // of mf_set_logo / mf_set_banner matches how the person described the
    // image (see SYSTEM_PROMPT).
    mf_set_banner: {
      risk: 'safe',
      run: async function(){
        const entry = kadessaPendingAttachments.find(function(a){ return a.kind === 'logo'; });
        if (!entry) throw new Error('no image attached this turn to use as a banner');
        await mfSetBannerFromDataUrl(entry.dataUrl);
      },
      label: function(){ return 'Set the attached image as this form\'s header banner.'; }
    },
    mf_toggle_required: { risk: 'safe',   run: function(p){ mfToggleFieldRequired(p.fieldId, !!p.required); }, label: function(p){ return (p.required ? 'Mark' : 'Unmark') + ' that field as required.'; } },
    mf_remove_field:   { risk: 'confirm', run: function(p){ mfRemoveField(p.fieldId); }, label: function(){ return 'Remove that field from the form. This can be undone with Ctrl+Z.'; } },
    // Pulls in whatever new submissions have landed on the published form's
    // Supabase row since the last check. mfSyncPublishedResponses() already
    // does its own precondition handling via toast (no form open / not
    // published), but toasts are silent from Kadessa's point of view -- she'd
    // say "On it" and the user would see nothing happen. Re-checking the
    // same preconditions here and throwing turns that into a real spoken
    // reply via kadessaExecuteAction's catch block instead.
    mf_sync_responses: {
      risk: 'safe',
      run: async function(p){
        // Build 245: p.formId / p.formTitle let her refresh a specific form
        // (not just the open one); mfSyncPublishedResponses already accepts
        // a form via opts.form.
        const f = mfKadessaResolveForm(p);
        if (!f.publishedId) throw new Error('"' + (f.title || 'Untitled Form') + '" was never published, so there\'s nothing online to check yet');
        await mfSyncPublishedResponses({ silent: true, form: f });
      },
      label: function(p){ return 'Check for new online responses' + (p && p.formTitle ? ' to "' + p.formTitle + '".' : ' to this form.'); }
    },
    // Same reasoning as mf_sync_responses above: mfExportResponsesToDA()
    // handles its own empty-state cases via toast, which Kadessa can't see or
    // relay -- these checks turn that into an actual error message back to
    // the user instead of a silent "On it" that did nothing.
    //
    // Build 245: picks WHICH form. Params:
    //   formId?    exact id from context.forms (preferred)
    //   formTitle? loose title match, used only when no id is given
    //   formIds?   array of ids, to send several forms in one go
    // With none of them it falls back to the open form, exactly as before.
    // Published forms are synced first (opt out with syncFirst:false) so the
    // table has the newest online submissions, not a stale local copy.
    mf_export_responses_to_da: {
      risk: 'safe',
      run: async function(p){
        p = p || {};
        const targets = [];
        if (Array.isArray(p.formIds) && p.formIds.length) {
          p.formIds.forEach(function(id){ const f = mfKadessaResolveForm({ formId: id }); if (targets.indexOf(f) === -1) targets.push(f); });
        } else {
          targets.push(mfKadessaResolveForm(p));
        }

        const sent = [], skipped = [];
        for (const f of targets) {
          const name = f.title || 'Untitled Form';
          if (f.publishedId && p.syncFirst !== false) {
            try { await mfSyncPublishedResponses({ silent: true, form: f }); }
            catch (e) { /* offline or Supabase hiccup: fall through to whatever is saved locally */ }
          }
          if (!mfGetResponses(f).length) { skipped.push('"' + name + '" has no saved responses yet'); continue; }
          if (!f.fields.some(function(fl){ return fl.type !== 'heading' && fl.type !== 'signature'; })) { skipped.push('"' + name + '" has no fillable fields'); continue; }
          const n = mfExportResponsesToDA(f, { noNavigate: true, silent: true });
          if (n) sent.push({ name: name, n: n });
        }

        if (!sent.length) throw new Error(skipped.join('; ') || 'nothing to send');

        if (typeof daWorkspaceRefreshVisibility === 'function') daWorkspaceRefreshVisibility();
        if (typeof daRenderTabs === 'function') daRenderTabs();
        if (typeof daRenderTable === 'function') daRenderTable();
        navigate('dataarrange');
        toast(sent.length === 1
          ? sent[0].n + ' response' + (sent[0].n > 1 ? 's' : '') + ' from "' + sent[0].name + '" sent to Data Arrangement'
          : sent.length + ' forms sent to Data Arrangement, one table each', 'success');
        if (skipped.length) toast('Skipped: ' + skipped.join('; '), 'info');
      },
      label: function(p){
        p = p || {};
        return 'Send ' + (p.formTitle ? '"' + p.formTitle + '"' : (Array.isArray(p.formIds) && p.formIds.length > 1 ? 'those forms' : 'this form')) + '\'s saved responses into Data Arrangement as a table.';
      }
    },

    // Kadessa's own "read this page" tool. Tiered exactly like the manual
    // Extract Text button (pdfedExtractPlainTextForPage / pdfedReadPageForKadessa
    // above): a real PDF text layer is used directly whenever one exists --
    // free, exact, no OCR or AI involved at all -- and only falls to local
    // OCR (PP-OCR/Tesseract, still free, still no AI) for flattened/scanned
    // pages or photos. Only when THAT comes back low-confidence does this
    // stash the page image in pdfedKadessaLastLowConfidenceRead, so a follow-up
    // pdfed_vision_reread_page call (below) can re-use it without redoing any
    // work. Results are shown in the same Extract Text modal the manual
    // button uses, so this looks and behaves identically to a person
    // clicking it themselves -- Copy/Download both just work.
    pdfed_read_page: {
      risk: 'safe',
      run: async function(p){
        if (pdfed.active < 0) throw new Error('no PDF is open');
        const idx = (p.pageNumber != null && p.pageNumber !== '') ? (Number(p.pageNumber) - 1) : pdfed.active;
        if (!(idx >= 0 && idx < pdfed.pages.length)) throw new Error('page ' + p.pageNumber + ' does not exist in this document');
        const pg = pdfed.pages[idx];

        pdfedKadessaLastLowConfidenceRead = null;
        pdfedShowOcrProgress('Reading page…');
        try {
          const worker = await pdfedGetOcrWorker();
          const result = await pdfedReadPageForKadessa(pg, worker);
          pdfedShowExtractTextModal([{ page: idx + 1, text: result.text }]);
          if (result.source === 'ocr' && result.dataUrl && result.confidence < PDFED_VISION_FALLBACK_MAX_CONF) {
            pdfedKadessaLastLowConfidenceRead = { pageIdx: idx, dataUrl: result.dataUrl, ocrText: result.text, confidence: result.confidence };
            toast('That looked like a rough scan (OCR confidence ' + result.confidence + '%). Say "get a better read with AI" if the text doesn\'t look right.', 'info');
          }
        } finally {
          pdfedHideOcrProgress();
        }
      },
      label: function(p){ return 'Read page ' + (p.pageNumber || 'the current page') + ' -- real PDF text where it exists, local OCR otherwise, no AI vision unless that local read comes back unclear.'; }
    },
    // Paid fallback -- only meaningful right after pdfed_read_page flagged an
    // uncertain OCR result (pdfedKadessaLastLowConfidenceRead set), or when the
    // person says the text Kadessa just read came out wrong. Sends the ACTUAL
    // page image straight to GPT-5.6 Luna's vision input for an exact
    // transcription pass, via the dedicated callKadessaVisionOcr() request --
    // never the ambient low-res screenshot captureVisionSnapshot attaches to
    // every ordinary turn. risk:'confirm' (unlike nearly every other action
    // here) because this is the one path that costs SARVARC real money per
    // call -- gated behind a free local read having already come back
    // uncertain, exactly the point of building it this way.
    pdfed_vision_reread_page: {
      risk: 'confirm',
      run: async function(){
        const pending = pdfedKadessaLastLowConfidenceRead;
        if (!pending) throw new Error("there's no recent uncertain page read to re-check -- ask me to read a page first");
        pdfedShowOcrProgress('Reading text (AI vision)…');
        try {
          const text = await callKadessaVisionOcr(pending.dataUrl, pending.ocrText);
          pdfedShowExtractTextModal([{ page: pending.pageIdx + 1, text: text }]);
          pdfedKadessaLastLowConfidenceRead = null;
        } finally {
          pdfedHideOcrProgress();
        }
      },
      label: function(){ return "Get an exact AI vision re-read of the page that came back unclear from local OCR (uses GPT-5.6 Luna vision -- costs more than the free local read)."; }
    },
    // Actually makes a page live-editable on the canvas, in place -- the gap
    // pdfed_read_page/pdfed_vision_reread_page above deliberately don't
    // close, since those are read-only (they hand text back in a modal).
    // This drives the SAME pipeline the manual "Edit Text" button uses
    // (pdfedStartTextEdit -> pdfedOcrExtract), so a real PDF text layer is
    // used exactly as-is (no OCR, no AI, nothing to get wrong), and only a
    // flattened/scanned page or a photo falls through to OCR at all.
    // risk:'confirm' because for THAT case, if the local OCR read comes back
    // uncertain, this automatically cross-checks the unclear wording against
    // GPT-5.6 Luna vision before finalizing the text (see pdfedOcrExtract's
    // own comment for exactly how that correction is scoped so it can only
    // ever fix wording, never move or restyle anything) -- a real, paid API
    // call, so the person confirms once up front rather than being asked
    // mid-flow. If the page is already editable (saved textBlocks from an
    // earlier session), this just reopens them -- no OCR or vision at all.
    pdfed_make_editable: {
      risk: 'confirm',
      run: async function(p){
        p = p || {};
        if (pdfed.active < 0) throw new Error('no PDF is open');
        const idx = (p.pageNumber != null && p.pageNumber !== '') ? (Number(p.pageNumber) - 1) : pdfed.active;
        if (!(idx >= 0 && idx < pdfed.pages.length)) throw new Error('page ' + p.pageNumber + ' does not exist in this document');
        if (pdfed.active !== idx) await pdfedGoto(idx);
        if (teState.active && pdfed.active === idx) {
          return { pageNumber: idx + 1, note: 'page was already open in Edit Text' };
        }
        await pdfedStartTextEdit({ allowVision: true, visionFetcher: callKadessaVisionOcr });
        return { pageNumber: idx + 1 };
      },
      label: function(p){
        return 'Make page ' + ((p && p.pageNumber) || 'the current page') + ' live-editable right on the canvas -- real PDF text is used exactly as-is, a flattened/scanned page or photo gets read with local OCR and turned into positioned, styled editable boxes in place, and if that local read comes back unclear anywhere, it\'s automatically cross-checked against GPT-5.6 Luna vision before finalizing the text (only for the unclear parts, and only then -- costs more only in that case).';
      }
    },

    pdfed_toggle_crop: { risk: 'safe',    run: function(){ pdfedToggleCrop(); }, label: function(){ return 'Toggle crop mode on the current page.'; } },
    pdfed_insert_table:{ risk: 'safe',    run: function(p){ pdfedInsertTable(p.rows || 3, p.cols || 3, {}); }, label: function(p){ return 'Insert a ' + (p.rows||3) + 'x' + (p.cols||3) + ' table into the page.'; } },
    // Drives the "Style Specific Text" panel directly -- finds every
    // occurrence of p.query across the WHOLE document (all pages, including
    // ones never opened in Edit Text, plus typed-in text boxes) and applies
    // bold/italic/font/colour to each one in a single pass, exactly like a
    // person typing the query and hitting Apply themselves. See
    // pdfedKadessaStyleSpecificText's own comment for the param defaults
    // (bold/italic default false, font/color default "unchanged" -- must
    // be explicit, never inherited from whatever the panel last held) and
    // clear_color for explicitly removing an existing colour. 'safe' since
    // every change lands on the existing teFaf undo stack (Ctrl+Z).
    pdfed_style_specific_text: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaStyleSpecificText(p || {}); },
      label: function(p){
        p = p || {};
        const bits = [];
        if (p.bold) bits.push('bold');
        if (p.italic) bits.push('italic');
        if (p.font) bits.push('a new font');
        if (p.clear_color) bits.push('no colour');
        else if (p.color) bits.push(p.color + ' colour');
        const styleNote = bits.length ? bits.join(', ') : 'the chosen style';
        return 'Find "' + p.query + '" everywhere in the document and apply ' + styleNote + '.';
      }
    },
    // Hands-on resize/opacity control over placed images and text boxes --
    // see pdfedKadessaResizeImage/pdfedKadessaResizeText/pdfedKadessaSetOpacity above
    // for the full param resolution (id / query / "first"/"last"/position,
    // scale_pct vs explicit px, aspect lock, etc).
    pdfed_resize_image: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaResizeImage(p || {}); },
      label: function(p){
        p = p || {};
        const which = p.id ? 'that image' : (p.which ? 'image ' + p.which : 'the image');
        const how = (p.scale_pct !== undefined && p.scale_pct !== null && p.scale_pct !== '')
          ? 'to ' + p.scale_pct + '% of its current size'
          : (p.width_px && p.height_px ? 'to ' + p.width_px + '×' + p.height_px + 'px' : (p.width_px ? 'to a width of ' + p.width_px + 'px' : 'to a height of ' + p.height_px + 'px'));
        return 'Resize ' + which + ' ' + how + '.';
      }
    },
    pdfed_resize_text: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaResizeText(p || {}); },
      label: function(p){
        p = p || {};
        const which = p.query ? '"' + p.query + '"' : (p.id ? 'that text box' : (p.which ? 'text box ' + p.which : 'the text box'));
        const how = (p.scale_pct !== undefined && p.scale_pct !== null && p.scale_pct !== '')
          ? 'to ' + p.scale_pct + '% of its current size'
          : 'to ' + p.font_size_px + 'px';
        return 'Resize ' + which + ' ' + how + '.';
      }
    },
    pdfed_resize_table: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaResizeTable(p || {}); },
      label: function(p){
        p = p || {};
        const which = p.id ? 'that table' : (p.which ? 'table ' + p.which : 'the table');
        const how = (p.scale_pct !== undefined && p.scale_pct !== null && p.scale_pct !== '')
          ? 'to ' + p.scale_pct + '% of its current size'
          : (p.width_px ? 'to a width of ' + p.width_px + 'px' : 'to a height of ' + p.height_px + 'px');
        return 'Resize ' + which + ' ' + how + '.';
      }
    },
    pdfed_set_opacity: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaSetOpacity(p || {}); },
      label: function(p){
        p = p || {};
        const kind = p.kind || 'image';
        const which = p.query ? '"' + p.query + '"' : (p.id ? 'that ' + kind : (p.which ? kind + ' ' + p.which : 'the ' + kind));
        return 'Set ' + which + ' opacity to ' + p.opacity + '%.';
      }
    },
    // Build 278: move things, layer them, and untangle overlapping text. See the block of
    // pdfedKadessaMoveItem / pdfedKadessaArrangeLayer / pdfedKadessaResolveOverlaps above. These hand
    // back { say } when the app made a choice the reply could not know in advance (an
    // auto-picked opacity, a nudge that was kept on the page); kadessaExecuteAction posts it.
    pdfed_move_item: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaMoveItem(p || {}); },
      label: function(p){
        p = p || {};
        const what = p.id ? 'that item' : (p.query ? '"' + p.query + '"' : 'the ' + (p.kind || 'item'));
        const where = p.position ? ' to the ' + String(p.position).replace(/_/g, ' ')
          : ((p.relative_to_id || p.relative_to_query) ? ' next to another item' : ' to a new spot');
        return 'Move ' + what + where + '.';
      }
    },
    pdfed_arrange_layer: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaArrangeLayer(p || {}); },
      label: function(p){
        p = p || {};
        const what = p.id ? 'that item' : (p.query ? '"' + p.query + '"' : 'the ' + (p.kind || 'item'));
        const how = String(p.mode || '').replace(/_/g, ' ');
        return 'Put ' + what + ' ' + (how || 'in a new layer') + '.';
      }
    },
    pdfed_resolve_overlaps: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaResolveOverlaps(p || {}); },
      label: function(){ return 'Pull overlapping text apart on this page.'; }
    },
    // Inserts a brand-new blank page anywhere in the document -- between
    // two existing pages (after_idx), at the end (position:'end'), or right
    // after whichever page is open (both omitted) -- at a real page size.
    // See pdfedKadessaInsertPage above for the full param resolution.
    pdfed_insert_page: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaInsertPage(p || {}); },
      label: function(p){
        p = p || {};
        const posLabel = p.position === 'end' ? 'at the end of the document'
          : (p.after_idx !== undefined && p.after_idx !== null && p.after_idx !== '') ? ('between page ' + (parseInt(p.after_idx,10)+1) + ' and the next')
          : 'right after the current page';
        const fmt = String(p.format || 'a4').toLowerCase() === 'custom'
          ? ((p.width_mm||210) + '×' + (p.height_mm||297) + 'mm')
          : String(p.format || 'a4').toUpperCase();
        const withText = Array.isArray(p.content) && p.content.length ? ', with editable text on it' : '';
        return 'Insert a new ' + fmt + ' page ' + posLabel + withText + '.';
      }
    },
    // Build 242: puts EDITABLE text boxes on a page that already exists (for
    // example one the person designed). Kadessa reads the screenshot, picks the
    // open area, and passes it as a region in percent of the page. See
    // pdfedKadessaAddTextToPage above.
    pdfed_add_text_to_page: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaAddTextToPage(p || {}); },
      label: function(p){
        p = p || {};
        const n = Array.isArray(p.blocks) ? p.blocks.length : 0;
        return 'Place ' + (n ? n + ' block' + (n === 1 ? '' : 's') + ' of ' : '') + 'editable text on this page.';
      }
    },
    // Content-aware table builder -- the editor-canvas counterpart to
    // da_create_table, but sized from the real text instead of a fixed
    // grid (see pdfedKadessaComputeTableLayout). Use this whenever the
    // person wants an actual table INSIDE a document/page they're
    // designing (an invoice, a comparison, a spec sheet) -- not for Data
    // Arrangement, which is the spreadsheet-style tool and has its own
    // da_create_table action.
    pdfed_create_table: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaCreateTable(p || {}); },
      label: function(p){
        p = p || {};
        const cols = Array.isArray(p.headers) ? p.headers.length : 0;
        const rows = (Array.isArray(p.rows) ? p.rows.length : 0) + 1; // +1 for the header row
        return 'Create a ' + rows + ' x ' + cols + ' table on this page, sized to fit its content.';
      }
    },
    // Lets a plain chat instruction ("undo that", "bring it back") reverse
    // whichever action Kadessa herself performed most recently, without the
    // person needing to reach for Ctrl+Z. See kadessaUndoLastAction above for
    // why this only fires when nothing has happened on top of it.
    // Changes the canvas size of one / some / all pages and rearranges the content
    // to suit the new shape (see pdfedKadessaResizeCanvas). Undo puts every page back.
    pdfed_resize_canvas: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaResizeCanvas(p || {}); },
      label: function(p){
        p = p || {};
        let to;
        if (p.aspect_ratio) to = String(p.aspect_ratio);
        else if (p.format && String(p.format).toLowerCase() !== 'custom') to = String(p.format).toUpperCase() + (p.orientation ? ' ' + p.orientation : '');
        else if (p.width_mm && p.height_mm) to = p.width_mm + '\u00d7' + p.height_mm + 'mm';
        else if (p.width_px && p.height_px) to = p.width_px + '\u00d7' + p.height_px + 'px';
        else to = 'a new layout';
        const where = p.pages === 'all' ? 'every page' : (Array.isArray(p.pages) && p.pages.length ? 'page' + (p.pages.length === 1 ? ' ' + p.pages[0] : 's ' + p.pages.join(', ')) : 'this page');
        return 'Change ' + where + ' to ' + to + ' and rearrange the content to fit.';
      }
    },
    kadessa_undo_last_action: {
      risk: 'safe',
      run: function(){
        const r = kadessaUndoLastAction();
        if (!r.undone) {
          throw new Error(r.reason === 'nothing yet'
            ? "there's nothing I've done yet to undo"
            : "something's changed since then, so I can't safely undo just that one thing -- Ctrl+Z (or Cmd+Z) will still step back through it");
        }
        return r;
      },
      label: function(){ return 'Undo my last change.'; }
    },
    // Bakes a solid colour or 2-colour gradient onto one page, every page,
    // or a specific set of pages -- via the same engine as the Design
    // panel's Solid/Gradient controls (see pdfedKadessaSetCanvasFill above).
    // `pages`: 'all' | [1,3,5] (1-based) | omitted for the page currently
    // open. `page_overrides`: [{page, color1, color2, mode?, angle?,
    // opacity?}] lets specific pages get their own different colour/
    // gradient in the SAME call, on top of (or instead of) the base style.
    pdfed_set_canvas_gradient: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaSetCanvasFill(p || {}); },
      label: function(p){
        p = p || {};
        const base = (p.mode === 'solid')
          ? 'Fill with ' + (p.color1 || 'the chosen colour')
          : 'Apply a ' + (p.color1 || 'colour') + ' \u2192 ' + (p.color2 || 'colour') + ' gradient';
        const nOv = Array.isArray(p.page_overrides) ? p.page_overrides.length : 0;
        const ovTxt = nOv ? ', with ' + nOv + ' page' + (nOv === 1 ? '' : 's') + ' getting its own colour' : '';
        if (p.pages === 'all') return base + ' to every page' + ovTxt + '.';
        if (Array.isArray(p.pages) && p.pages.length) return base + ' to page' + (p.pages.length === 1 ? ' ' + p.pages[0] : 's ' + p.pages.join(', ')) + ovTxt + '.';
        return base + ' to this page\'s canvas' + ovTxt + '.';
      }
    },
    // Translates placed text boxes into another language: one page, every
    // page, or a specific set of pages, all in ONE call -- via the same
    // free MyMemory Translation API the manual Translate/Translate All
    // buttons use (see pdfedKadessaTranslatePages above). `pages`/`page_
    // overrides` work exactly like pdfed_set_canvas_gradient's, but each
    // override carries a `lang` instead of a colour, so "translate
    // everything to Hindi, except page 3 which should be Gujarati" is one
    // call: {lang:'hi', pages:'all', page_overrides:[{page:3, lang:'gu'}]}.
    pdfed_translate_pages: {
      risk: 'confirm',
      run: async function(p){ return await pdfedKadessaTranslatePages(p || {}); },
      label: function(p){
        p = p || {};
        const nOv = Array.isArray(p.page_overrides) ? p.page_overrides.length : 0;
        const ovTxt = nOv ? ', with ' + nOv + ' page' + (nOv === 1 ? '' : 's') + ' in its own language' : '';
        const langTxt = p.lang ? '"' + p.lang + '"' : 'the given language';
        if (p.pages === 'all') return 'Translate every page\'s text into ' + langTxt + ovTxt + '. This can be undone per page with Ctrl+Z.';
        if (Array.isArray(p.pages) && p.pages.length) return 'Translate page' + (p.pages.length === 1 ? ' ' + p.pages[0] : 's ' + p.pages.join(', ')) + ' into ' + langTxt + ovTxt + '. This can be undone per page with Ctrl+Z.';
        return 'Translate this page\'s text into ' + langTxt + ovTxt + '. This can be undone with Ctrl+Z.';
      }
    },
    // Sets a placed-text box's fill to a solid colour or a 2-colour
    // gradient, via the exact same engine as the "A" swatch / gradient
    // popover on the Add Text toolbar (see pdfedKadessaSetTextFill above), so
    // it bakes into export identically to a manual edit. `target` picks
    // WHICH box: omit it for whichever box is currently open, or the only
    // text box on the page when none is open; pass `query` (a snippet of
    // the box's own words, e.g. "Prayag Pathak") to aim at a specific box
    // by content when there's more than one candidate; pass target:'all'
    // for every text box on the page at once. `mode` is 'solid'|'gradient',
    // inferred from whether color2 is given when omitted; pass mode:'clear'
    // to strip an existing colour/gradient back to plain black. LEAVE
    // color1/color2 OUT ENTIRELY for a vague ask ("give the heading some
    // colour", "make the title pop") -- this then reads the actual page
    // background behind that text and picks a legible, deliberate-looking
    // pair itself, the same "read the page, don't just guess" judgment
    // pdfed_apply_image_design uses for a vague image request; it does NOT
    // ask the person to pick colours first. angle follows the same CSS
    // linear-gradient() convention as pdfed_set_canvas_gradient (0=up,
    // 90=left-to-right, clockwise); omit it to keep an existing gradient's
    // angle, or default to 90 for a brand-new one.
    pdfed_set_text_fill: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaSetTextFill(p || {}); },
      label: function(p){
        p = p || {};
        const target = p.query ? ('"' + p.query + '"') : (p.target === 'all' ? 'every text box on this page' : 'this text');
        if (p.mode === 'clear') return 'Remove the colour/gradient from ' + target + ' and reset it to plain black.';
        if (p.mode === 'solid' || (p.color1 && !p.color2)) {
          return 'Colour ' + target + (p.color1 ? ' ' + p.color1 : ' with a colour that fits the page') + '.';
        }
        return 'Apply a' + (p.color1 && p.color2 ? (' ' + p.color1 + ' \u2192 ' + p.color2) : '') + ' gradient to ' + target + (p.color1 && p.color2 ? '' : ', picking colours that fit the page') + '.';
      }
    },
    // Bakes any of the Design panel's Cinematic Fade / Premium 3D Cinematic /
    // Cosmic presets onto placed image(s) directly, via the exact same engine
    // as the panel's own Apply Fade button (see pdfedKadessaApplyImageDesign
    // above) -- undo, export, and thumbnails all treat this identically to a
    // manual apply. This is the tool DESIGN STUDIO JUDGMENT in the system
    // prompt above pairs with: for a vague mood/intent request ("make this
    // a bit faded," "give it some uniqueness") Kadessa picks BOTH preset and
    // strength herself and calls this directly, she does not ask the person
    // to choose from the 21 names first.
    pdfed_apply_image_design: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaApplyImageDesign(p || {}); },
      label: function(p){
        p = p || {};
        const preset = PDFED_DESIGN_PRESETS.find(function(pr){ return pr.id === p.preset; });
        const name = preset ? preset.name : (p.preset || 'that fade');
        const strengthNote = (p.strength !== undefined && p.strength !== null && p.strength !== '') ? ' at ' + p.strength + '% strength' : '';
        const targetNote = p.target === 'all' ? ' to every image on this page' : '';
        return 'Apply the ' + name + ' effect' + strengthNote + targetNote + '.';
      }
    },
    // Build 275: Kadessa's own hands on the Image Reshaper + Shape Studio. Cuts placed
    // or gallery images into a built-in shape, a My Shapes entry, or a shape she
    // BUILDS in the same call (recipe / nodes / path), with keep-proportions, zoom,
    // auto-focus on the subject, inset/rotate/flip, bevel, flat border and shadow.
    pdfed_reshape_image: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaReshapeImage(p || {}); },
      label: function(p){
        p = p || {};
        if (p.new_shape && typeof p.new_shape === 'object') {
          return 'Design a new shape' + (p.new_shape.name ? ' ("' + String(p.new_shape.name).slice(0, 40) + '")' : '') + ' and cut the image into it' + (p.target === 'all' ? ' (every image)' : '') + '.';
        }
        const sh = pdfedKadessaFindReshapeShape(p.shape || p.shape_id || p.shapeId || p.name || '');
        return 'Reshape the image into a ' + (sh ? sh.name : (p.shape || 'new')) + ' shape' + (p.target === 'all' ? ' (every image)' : '') + '.';
      }
    },
    // Build 291: take the live shape / filter off a live clip (applying one is pdfed_reshape_image / pdfed_apply_image_design).
    pdfed_clear_live_look: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaClearLiveLook(p || {}); },
      label: function(p){
        p = p || {};
        return 'Remove the live ' + (p.what === 'shape' ? 'shape' : (p.what === 'filter' ? 'filter' : 'shape and filter')) + ' from the clip.';
      }
    },
    pdfed_create_custom_shape: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaCreateCustomShape(p || {}); },
      label: function(p){ return 'Design a new shape called "' + String((p && p.name) || 'My Shape').slice(0, 40) + '" and save it to My Shapes.'; }
    },
    pdfed_edit_custom_shape: {
      risk: 'safe',
      run: async function(p){ return await pdfedKadessaEditCustomShape(p || {}); },
      label: function(p){
        p = p || {};
        return (p.as_copy ? 'Save a changed copy of the "' : 'Change the "') + String(p.shape || 'shape').slice(0, 40) + '" shape.';
      }
    },
    pdfed_delete_custom_shape: {
      risk: 'confirm',
      run: async function(p){ return await pdfedKadessaDeleteCustomShape(p || {}); },
      label: function(p){ return 'Delete the "' + String((p && p.shape) || 'shape').slice(0, 40) + '" shape from My Shapes. This cannot be undone.'; }
    },
    // Build 272: page-to-page transitions (see PAGE TRANSITIONS block). Same engine
    // as the picker next to each + insert button.
    pdfed_set_page_transition: {
      risk: 'safe',
      run: function(p){
        p = p || {};
        const n = pdfed.pages.length;
        if (n < 2) return 'There is only one page, so there is no page change to animate yet.';
        const okIds = PDFED_ANIM_TYPES.map(function(t){ return t.id; });
        // One entry per group of page changes. A single request is one entry; `plan`
        // lets Kadessa give different gaps different looks in the same call.
        const entries = Array.isArray(p.plan) && p.plan.length ? p.plan.slice(0, 60) : [p];
        const done = [];
        entries.forEach(function(o){
          o = (o && typeof o === 'object') ? o : {};
          let idxs = [];
          if (o.after_page !== undefined && o.after_page !== null && o.after_page !== '') {
            idxs = [Number(o.after_page) - 1];
          } else if (Array.isArray(o.pages) && o.pages.length) {
            idxs = o.pages.map(function(x){ return Number(x) - 1; });
          } else if (entries.length === 1 || o.pages === 'all') {
            for (let i = 0; i < n - 1; i++) idxs.push(i);
          }
          idxs = idxs.filter(function(x){ return isFinite(x) && x >= 0 && x < n - 1; });
          if (!idxs.length) return;
          if (o.clear === true) { pdfedAnimClear(idxs); done.push('cleared after page(s) ' + idxs.map(function(i){ return i + 1; }).join(', ')); return; }
          const speed = PDFED_ANIM_SPEEDS[o.speed] ? o.speed : 'normal';
          const extra = {};
          const dur = Number(o.duration_ms);
          if (isFinite(dur) && dur >= 150 && dur <= 4000) extra.ms = Math.round(dur);
          let type, name;
          const hasCustom = o.custom && typeof o.custom === 'object' && !Array.isArray(o.custom) && Object.keys(o.custom).length;
          if (hasCustom) {
            type = 'custom'; extra.spec = pdfedFxSpec(o.custom);
            extra.label = (typeof o.label === 'string' && o.label.trim()) ? o.label.trim() : 'Custom';
            name = extra.label + ' (custom)';
          } else if (okIds.indexOf(o.type) !== -1) {
            type = o.type; name = pdfedAnimName(type);
            if (typeof o.label === 'string' && o.label.trim()) extra.label = o.label.trim();
          } else if (typeof o.type === 'string' && o.type.trim()) {
            throw new Error('"' + o.type + '" is not a built-in preset. Build it yourself with the custom object (motion, direction, mask, fade, dip, scale, out_scale, rotate, ease, edge, base) instead of a type.');
          } else { type = 'fade'; name = pdfedAnimName(type); }
          pdfedAnimSet(idxs, type, speed, extra);
          done.push(name + ' (' + (extra.ms ? extra.ms + 'ms' : speed) + ') after page(s) ' + idxs.map(function(i){ return i + 1; }).join(', '));
        });
        if (!done.length) return 'No valid page changes matched.';
        try { toast(pdfedAnimNoticeText(), 'info'); } catch (e) {}
        const shown = done.length > 12 ? done.slice(0, 12).join('; ') + '; and ' + (done.length - 12) + ' more' : done.join('; ');
        return 'Done: ' + shown + '. Reminder for the user: ' + pdfedAnimNoticeText();
      },
      label: function(p){
        p = p || {};
        if (Array.isArray(p.plan) && p.plan.length) return 'Set page transitions, with a different look for ' + p.plan.length + ' page change(s).';
        if (p.clear === true) return 'Remove the page transition' + (Array.isArray(p.pages) ? ' after page(s) ' + p.pages.join(', ') : 's') + '.';
        const nm = p.custom && p.label ? p.label : (p.type || (p.custom ? 'custom' : 'fade'));
        return 'Add a ' + nm + ' transition ' + (p.after_page ? 'after page ' + p.after_page : (Array.isArray(p.pages) ? 'after page(s) ' + p.pages.join(', ') : 'between every page')) + '.';
      }
    },
    // Inserts the Business Proposal template (see bpInsertTemplateToCanvas
    // above) with a chosen skin but no content filled in -- the same
    // placeholder version clicking a tile in the gallery modal produces.
    // Kadessa should reach for pipeline_details_to_proposal instead the moment
    // she actually has real client/project/pricing details to put on it;
    // this bare action is only for "just drop a proposal template on the
    // canvas, I'll fill it in myself." key is one of BP_TEMPLATE_LABELS'
    // keys (modern, navy, gradient, elegant, dark); omit for 'modern'.
    bp_insert_template: {
      risk: 'safe',
      run: async function(p){ await bpInsertTemplateToCanvas((p && p.key) || 'modern', {}); },
      label: function(p){
        const key = (p && p.key) || 'modern';
        return 'Insert a blank ' + (BP_TEMPLATE_LABELS[key] || 'Business Proposal') + ' template onto the canvas.';
      }
    },
    // Saves the Brand Kit (see bkSave above) -- company name, tagline, and/
    // or logo (a data URL) -- so every proposal inserted from now on auto-
    // applies it. Fields left out keep whatever was already saved, matching
    // bkSaveFromPanel's own behaviour of only overwriting what was actually
    // typed/uploaded.
    bk_set_brand_kit: {
      risk: 'safe',
      run: function(p){
        p = p || {};
        const existing = bkLoad() || {};
        // use_attached_logo: take the logo the person just attached in Kadessa's
        // chat (kept in pdfedRefineState by the attach flow), so Kadessa never
        // has to handle raw image data herself.
        let attached;
        if (p.use_attached_logo === true) {
          attached = pdfedRefineState && pdfedRefineState.logoDataUrl;
          if (!attached) throw new Error('no logo is attached. Use the paperclip in my chat to attach one first');
        }
        bkSave({
          logo: attached ? attached : (p.logo !== undefined ? p.logo : existing.logo),
          company: p.company !== undefined ? p.company : existing.company,
          tagline: p.tagline !== undefined ? p.tagline : existing.tagline
        });
      },
      label: function(p){
        p = p || {};
        const bits = [];
        if (p.company) bits.push('company name to "' + p.company + '"');
        if (p.tagline) bits.push('tagline to "' + p.tagline + '"');
        if (p.logo || p.use_attached_logo) bits.push('logo');
        return 'Save the Brand Kit' + (bits.length ? ' (' + bits.join(', ') + ')' : '') + ' so future proposals use it automatically.';
      }
    },
    // Adds a second (or Nth) page to a proposal -- Terms & Conditions, an
    // extended scope writeup, anything text-based -- styled to match the
    // proposal's own skin (see bpInsertContinuationPage above). For a
    // timeline/Gantt chart page, use the existing dg_* actions +
    // pipeline_diagram_to_pdf instead; this one is for text content only.
    // blocks is an array of paragraph strings, one per placed text box.
    bp_insert_continuation_page: {
      risk: 'safe',
      run: async function(p){ await bpInsertContinuationPage((p && p.key) || 'modern', p || {}); },
      label: function(p){
        p = p || {};
        return 'Add a "' + (p.title || 'Additional Notes') + '" page to the proposal, styled to match it.';
      }
    },
    pdfed_remove_page: { risk: 'confirm', run: function(p){ pdfedQueueRemove(p.idx); }, label: function(p){ return 'Remove page ' + (p.idx+1) + ' from the document. This can be undone with Ctrl+Z.'; } },
    // Opens the real Refine Report modal rather than Kadessa attempting to
    // restructure the document herself -- she can diagnose and suggest,
    // but the actual font/spacing/heading pass always runs through the
    // app's own engine, with the person reviewing options before applying.
    pdfed_open_refine_report: { risk: 'safe', run: function(){ pdfedOpenRefineReportModal(); }, label: function(){ return 'Open Refine Report so you can review and apply it.'; } },
    // Autopilot version of the tool above -- runs the full Refine Report
    // pipeline immediately with the theme/table-width/logo/header choices
    // Kadessa herself decided, no modal, nothing for the person to click. This
    // is what "give me the professional output" / "make this look
    // professional" should call, not pdfed_open_refine_report -- see the
    // ACTIONS section of SYSTEM_PROMPT below for when to use which.
    pdfed_auto_refine_report: {
      risk: 'safe',
      run: async function(p){
        const result = await pdfedRunRefineReportAuto({
          theme: p.theme, align: p.align, sectionIcons: p.section_icons,
          addLogoToHeader: p.add_logo_to_header, logoPosition: p.logo_position,
          watermarkEnabled: p.watermark_enabled, footerEnabled: p.footer_enabled,
          headerTitle: p.header_title, headerSubheading: p.header_subheading,
          headerContact: p.header_contact, headerAddress: p.header_address,
        });
        return result && result.summaryLine;
      },
      label: function(p){
        const themeLabel = (PDFED_REFINE_THEMES[p.theme] || PDFED_REFINE_THEMES.general).label;
        const widthNote = p.align === 'stretch' ? ', tables stretched to full width' : '';
        return 'Refine this into a polished ' + themeLabel + ' report' + widthNote + ' -- applying now, no review step.';
      }
    },
    // "Make me a letterhead" -- reuses this exact same Refine Report engine
    // (see pdfedCreateEmptyLetterhead above) instead of a separate template
    // system: inserts a blank page if none is open, drops the attached
    // logo into the header plus a soft watermark behind the page, and
    // leaves the body empty. Requires a logo already attached in chat --
    // if pdfedCreateEmptyLetterhead throws because none is attached, ask
    // the person to attach one with the paperclip, then call this again.
    pdfed_create_letterhead: {
      risk: 'safe',
      run: async function(p){ return await pdfedCreateEmptyLetterhead(p || {}); },
      label: function(){ return 'Create a blank, watermarked letterhead from your logo.'; }
    },

    // ── DAILY-USE RIBBON ACTIONS ─────────────────────────────────────────
    pdfed_rotate_page:  { risk: 'safe',    run: function(p){ pdfedRotatePage(p.direction === 'left' ? -90 : 90); }, label: function(p){ return 'Rotate the current page ' + (p.direction === 'left' ? 'left' : 'right') + ' 90°.'; } },
    pdfed_duplicate_page:{ risk: 'safe',   run: function(){ pdfedDuplicatePage(pdfed.active); }, label: function(){ return 'Duplicate the current page.'; } },
    // Discards every edit made to this page since it was loaded -- genuinely
    // destructive (not just "undo one step"), so this gets a confirm even
    // though the app's own undo history could theoretically claw it back.
    pdfed_revert_page:  { risk: 'confirm', run: function(){ pdfedRevertPage(); }, label: function(){ return 'Revert this page, discarding all edits made to it. This can be undone with Ctrl+Z right after, but not once you\'ve made further changes.'; } },
    // Exports the whole open document as a PDF and triggers the browser
    // download -- the same file pdfedExport() produces when the export
    // modal's defaults (all pages, PDF format, no password) are used, just
    // skipping the modal itself. p.password optionally encrypts the file;
    // p.successLabel optionally customizes the toast (e.g. "Proposal
    // exported and ready to send").
    pdfed_export_pdf: {
      risk: 'safe',
      run: async function(p){ p = p || {}; await pdfedExport(null, p.password || null, null, p.successLabel); },
      label: function(p){
        p = p || {};
        return 'Export the document as a PDF' + (p.password ? ' (password protected)' : '') + ' and download it.';
      }
    },
    pdfed_zoom:          { risk: 'safe',    run: function(p){ pdfedZoom(p.direction === 'out' ? -0.1 : 0.1); }, label: function(p){ return 'Zoom ' + (p.direction === 'out' ? 'out' : 'in') + '.'; } },
    pdfed_zoom_fit:      { risk: 'safe',    run: function(){ pdfedZoomFit(); }, label: function(){ return 'Fit the page to the window.'; } },
    // Deliberately excludes 'redact' from the allowed tool list -- Kadessa has
    // no reach into Redaction, even indirectly through the shared tool
    // switcher. Only these four are ever passed through.
    pdfed_set_tool:      { risk: 'safe',    run: function(p){ var allowed = ['draw','eraser','addtext','link']; if (allowed.indexOf(p.tool) === -1) throw new Error('tool not permitted'); pdfedSetAnnotTool(p.tool); }, label: function(p){ return 'Switch to the ' + p.tool + ' tool.'; } },
    // Selects AND activates a shape tool in one step (mirrors what clicking
    // a shape in the ribbon's dropdown, then the main shape button, does).
    pdfed_select_shape:  { risk: 'safe',    run: function(p){ pdfedShapesSelect(p.shape); pdfedSetAnnotTool(p.shape); }, label: function(p){ return 'Switch to the ' + p.shape + ' shape tool.'; } },

    // Real photo SEARCH, not image generation -- SARVARC's stock photo tool
    // is backed by Pexels, so this finds an actual existing photo matching
    // the query, it doesn't create a new one from scratch. Bypasses the
    // search modal's UI entirely (fetches directly, same endpoint) and
    // reuses pdfedActivateImgGhost's own smart default centering + cascade
    // logic, then immediately bakes it in -- no drag needed, since that
    // default position was already good enough for a person to just click
    // "place" on. If the query returns nothing, throws so the person gets
    // a clear "no results" message instead of a silent no-op.
    // Places the image the person attached in Kadessa's chat (the paperclip) onto
    // the open page as a normal movable picture, using the same ghost/bake path
    // as the stock photo action. The attach flow already stored the file in
    // pdfedRefineState.logoDataUrl, so nothing new has to be uploaded.
    // NOTE: the Worker must also define a tool with this exact name, or Kadessa
    // will never call it (see kadessa-worker-tool-snippet.txt).
    pdfed_insert_attached_image: {
      risk: 'safe',
      run: async function(){
        if (pdfed.active < 0) throw new Error('there is no page open yet, so I will add a blank page first if you ask me to');
        const url = pdfedRefineState && pdfedRefineState.logoDataUrl;
        if (!url) throw new Error('no image is attached. Use the paperclip in my chat to attach one first');
        pdfedActivateImgGhost(url);
        await pdfedBakeImage();
      },
      label: function(){ return 'Place the image you attached onto the current page.'; }
    },
    pdfed_insert_stock_photo: {
      risk: 'safe',
      run: async function(p){
        if (pdfed.active < 0) throw new Error('open a page first');
        const q = String(p.query || '').trim();
        if (!q) throw new Error('no search term given');
        const url = PDFED_STOCK_PROXY_ENDPOINT + '?query=' + encodeURIComponent(q) + '&page=1&per_page=1';
        const res = await fetch(url);
        if (!res.ok) throw new Error('stock photo search failed');
        const data = await res.json();
        const photo = Array.isArray(data.photos) && data.photos[0];
        if (!photo) throw new Error('no photos found for "' + q + '"');
        const large = (photo.src && (photo.src.large2x || photo.src.large || photo.src.original));
        const imgRes = await fetch(large);
        if (!imgRes.ok) throw new Error('could not load the photo');
        const blob = await imgRes.blob();
        const dataUrl = await new Promise(function(resolve, reject){
          const reader = new FileReader();
          reader.onload = function(){ resolve(reader.result); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        pdfedActivateImgGhost(dataUrl);
        await pdfedBakeImage();
      },
      label: function(p){ return 'Search stock photos for "' + p.query + '" and place the best match.'; }
    },

    // ── PIPELINE ACTIONS ───────────────────────────────────────────────
    // These move data BETWEEN modules -- the actual form-to-DA-to-diagram-to-PDF
    // flow that's SARVARC's core differentiator. Each one calls the exact same
    // function the person's own push button calls, so it inherits that
    // function's existing conflict handling (e.g. daPushToDiagrams opens the
    // app's own overlay if a chart already exists -- Kadessa doesn't bypass that,
    // the person still resolves it same as always) and undo/redo behavior.
    // All marked 'safe' since they're additive (create/replace content the
    // person can already undo), never destructive on their own.
    pipeline_da_to_diagram: { risk: 'safe', run: function(){ daPushToDiagrams(null); }, label: function(){ return 'Send this table to Diagrams & Graphs.'; } },
    pipeline_da_to_pdf:     { risk: 'safe', run: function(p){ daPushToWorkflow(p.mode === 'live' ? 'live' : 'new', { filteredOnly: p.filtered_only === true }); }, label: function(p){ return 'Push this table into the ' + (p.mode === 'live' ? 'current PDF page' : 'PDF Editor as a new page') + '.'; } },
    // Build 259: a written Word/PDF report (Topic / Content dataset) becomes real
    // heading + body text on new pages, ready for pdfed_auto_refine_report.
    // Use this instead of pipeline_da_to_pdf for prose; that one draws a grid.
    // Build 299: "find what is hurting my business" filters the rows, then
    // "make me a report" sends ONLY those filtered rows to the PDF Editor as a
    // table first, then writes three summaries (What's Happening / Why It
    // Happened / How It Can Be Improved) on the page after the table.
    pipeline_filtered_report_to_pdf: { risk: 'safe', run: async function(p){ return await kadessaFilteredReportToPdf(p || {}); }, label: function(){ return 'Send only the filtered rows to the PDF Editor with three written summaries.'; } },
    pipeline_report_to_pdf: { risk: 'safe', run: async function(p){ return await kadessaInsertReportFromProse(p || {}); }, label: function(){ return 'Place this written report on new PDF pages as editable headings and paragraphs.'; } },
    pipeline_diagram_to_pdf:{ risk: 'safe', run: function(p){ dgInsertIntoWorkspace(p.mode === 'live' ? 'live' : 'new'); }, label: function(p){ return 'Push this chart into the ' + (p.mode === 'live' ? 'current PDF page' : 'PDF Editor as a new page') + '.'; } },
    pipeline_form_to_pdf:   { risk: 'safe', run: function(){ mfPushToWorkspace(); }, label: function(){ return 'Push this form into the PDF Editor.'; } },
    // The real "make me a proposal" action -- takes content Kadessa has
    // already gathered from the conversation (clientName, projectTitle,
    // summary, deliverables[], pricing[] as {description,qty,rate,amount},
    // total, paymentTerms, date, validUntil, signerName, skin, brand:
    // {company,tagline,logo}, colors: {gradFrom,gradTo,headingColor,
    // totalColor,...} for a custom brand palette on top of a base skin) and
    // produces a filled, on-brand proposal on the canvas in one shot. NOT
    // for placeholders -- if the person has only said "make me a proposal"
    // with no client/project/deliverables/pricing yet, ask for those first
    // (batched into one question, skipping anything already covered
    // earlier in the conversation) rather than calling this with guesses;
    // see kadessaInsertProposalFromDetails above, which throws if truly
    // nothing was given. Soft fields (paymentTerms, date, validUntil,
    // signerName) are fine to default quietly without asking.
    pipeline_details_to_proposal: {
      risk: 'safe',
      run: async function(p){ await kadessaInsertProposalFromDetails(p || {}); },
      label: function(p){
        p = p || {};
        const who = p.clientName ? (' for ' + p.clientName) : '';
        return 'Put together a business proposal' + who + ' from the details discussed, and add it to the canvas.';
      }
    },

    // GUARD (added after Kadessa was observed calling this on the panel the
    // user was ALREADY in -- e.g. asked for "make a pie chart" while
    // sitting in Diagrams & Graphs, and Kadessa replied "I'll switch you to
    // Diagrams & Graphs" instead of just calling dg_set_type). With
    // reasoning_effort forced to "none" for tool calls (see the Worker),
    // navigate_to_panel is the one tool that's ALWAYS offered regardless
    // of context, which makes it an easy low-effort fallback for the
    // model to reach for when it's unsure which panel-specific tool
    // actually does the job -- especially since it was always listed
    // FIRST in the tools array the Worker sends. Two independent fixes:
    // this client-side guard (so a same-panel call surfaces a real
    // message instead of silently doing nothing) and, on the Worker
    // side, an explicit system-prompt rule plus reordering navigate_to_panel
    // to last in the tools array.
    // SHOWCASE: Kadessa's hands on every Showcase control. One call can open it, load a
    // photo, change any mix of settings, move the playhead and export -- because a turn
    // carries a single action, so she collapses a whole request ("make it a sleek 9:16
    // reel with a headline and download it") into one spp_studio call.
    spp_studio: {
      risk: 'safe',
      run: async function(p){
        p = p || {};
        const api = window.sppKadessa;
        if (!api) throw new Error('Showcase is not available here');
        api.open();
        const before = api.snapshot();
        const notes = [];
        if (p.photo && typeof p.photo === 'object'){
          const src = String(p.photo.source || 'page');
          if (src === 'attached'){
            const list = kadessaPendingAttachments.filter(function(a){ return a.kind === 'logo' && a.dataUrl; });
            const entry = list[list.length - 1];
            if (!entry) throw new Error('no photo is attached. Use the paperclip in my chat to attach one first');
            await api.load({ dataUrl: entry.dataUrl, name: entry.name });
          } else {
            await api.load({ which: p.photo.which });
          }
        }
        if (p.photos && typeof p.photos === 'object'){
          let urls = [];
          if (String(p.photos.source || 'attached') === 'page') urls = api.pageImages(p.photos.which || 'all');
          else {
            urls = kadessaPendingAttachments.filter(function(a){ return a.kind === 'logo' && a.dataUrl; }).map(function(a){ return a.dataUrl; });
            if (!urls.length) throw new Error('no photos are attached. Use the paperclip in my chat to attach them first');
          }
          const lr = await api.loadMany(urls, p.photos.mode === 'add' ? 'add' : 'replace');
          notes.push('Showcase now holds ' + lr.total + ' photo' + (lr.total === 1 ? '' : 's') + '.' + (lr.dropped ? ' It keeps up to 12, so ' + lr.dropped + ' did not fit.' : ''));
        }
        if (p.gallery && typeof p.gallery === 'object'){
          const did = api.editGallery(p.gallery);
          if (did.length) notes.push('I ' + did.join(', ') + '.');
        }
        const r = api.configure(p.settings || {});
        if (r.skipped.length) notes.push('I skipped ' + r.skipped.join('; ') + '.');
        let tx = null;
        if (p.texts && typeof p.texts === 'object' && api.texts){
          tx = api.texts(p.texts);
          if (tx.did.length) notes.push('I ' + tx.did.join(', ') + '. Showcase now has ' + tx.total + ' extra text' + (tx.total === 1 ? '' : 's') + '.');
          if (tx.skipped.length) notes.push('I skipped: ' + tx.skipped.join('; ') + '.');
        }
        if (api.hasCut() || (p.photo && typeof p.photo === 'object')) api.flushCut();
        if (p.playback) api.setPlayback(String(p.playback));
        if (p.time !== undefined && p.time !== null && p.time !== '') api.seek(p.time);
        if (p.compare !== undefined) api.setCompare(p.compare === true || p.compare === 'true');
        const tr = p.tour ? api.tour(p.tour.motions, p.tour.secs_each) : null;
        if (p.tour && !tr) notes.push('None of those motions fit the current layout, so I left the motion as it was.');
        if ((Object.keys(r.applied).length || tr || (tx && tx.changed)) && typeof pushKadessaAppHistory === 'function'){
          const after = api.snapshot();
          if (tr) after.o[tr.key] = tr.last;
          pushKadessaAppHistory({
            label: 'Showcase settings (Kadessa)',
            undo: function(){ api.restore(before); toast('Showcase settings put back', 'info'); },
            redo: function(){ api.restore(after); }
          });
        }
        const ctx = api.context();
        if (ctx.photo && r.applied && (r.applied.ratio || r.applied.fit || p.photo)){
          const sh = ctx.photo.fillModeSharpness[ctx.settings.ratio];
          if (ctx.settings.fit === 'fill' && sh && sh !== 'sharp') notes.push('Heads up: this photo is ' + ctx.photo.originalSize[0] + ' x ' + ctx.photo.originalSize[1] + ', so a ' + ctx.settings.ratio + ' export will be ' + sh + ' and may look soft.');
          if (ctx.settings.fit === 'product' && ctx.photo.backgroundLooksBusy && ctx.settings.cutout) notes.push('The photo background looks busy, so the cutout may be rough. Say the word and I will switch to Fill to edges instead.');
        }
        if (p.output){
          let kind = String(p.output);
          if (kind === 'live' && !(typeof pdfed !== 'undefined' && pdfed.active >= 0 && pdfed.pages[pdfed.active])){
            kind = 'place'; notes.push('No page is open, so I placed it as a still on a new page instead of a live clip.');
          }
          await api.output(kind);
        }
        return notes.length ? { say: notes.join(' ') } : null;
      },
      label: function(p){
        p = p || {};
        const bits = [];
        if (p.photo) bits.push('load ' + (p.photo.source === 'attached' ? 'the attached photo' : 'the photo from the page'));
        const st = p.settings || {};
        const n = Object.keys(st).length;
        if (n) bits.push('adjust ' + n + ' Showcase setting' + (n === 1 ? '' : 's'));
        if (p.photos) bits.push('load the photos');
        if (p.gallery) bits.push('arrange the photos');
        if (p.texts) bits.push('write the texts');
        if (p.tour) bits.push('preview the motions');
        if (p.playback || p.time !== undefined) bits.push('control playback');
        if (p.output) bits.push({ png: 'download a PNG', video: 'record the video', place: 'place it on the page', live: 'place it as a live clip' }[p.output] || 'export');
        return 'In Showcase: ' + (bits.length ? bits.join(', ') : 'open it') + '.';
      }
    },
    spp_reset: {
      risk: 'confirm',
      run: function(){
        const api = window.sppKadessa;
        if (!api) throw new Error('Showcase is not available here');
        api.open();
        const before = api.snapshot();
        api.reset();
        if (api.hasCut()) api.flushCut();
        if (typeof pushKadessaAppHistory === 'function'){
          const after = api.snapshot();
          pushKadessaAppHistory({
            label: 'Reset Showcase settings (Kadessa)',
            undo: function(){ api.restore(before); toast('Showcase settings put back', 'info'); },
            redo: function(){ api.restore(after); }
          });
        }
      },
      label: function(){ return 'Reset every Showcase setting back to its default. Your photo stays.'; }
    },
    spp_close: {
      risk: 'safe',
      run: function(){ if (window.sppKadessa) window.sppKadessa.close(); },
      label: function(){ return 'Close Showcase.'; }
    },
    navigate_to_panel: {
      risk: 'safe',
      run: function(p){
        var map = { 'Dashboard': 'dashboard', 'PDF Editor': 'pdfeditor', 'Extract Images': 'extract', 'Data Arrangement': 'dataarrange', 'Make Forms': 'makeforms', 'Diagrams & Graphs': 'diagrams', 'Redact PII': 'redact' };
        var sec = map[p.panel];
        if (!sec) throw new Error('unknown panel "' + p.panel + '"');
        if (sec === unifiedActiveSection()){
          // Already here -- navigating again is a silent no-op that would
          // otherwise look like Kadessa did nothing at all. Throw so the
          // caller surfaces a real line instead, and nudge toward
          // actually finishing the request.
          throw new Error("you're already in " + p.panel + ", so there's nothing to switch. Tell me what you'd like changed here and I'll do it directly");
        }
        navigate(sec);
      },
      label: function(p){ return 'Open ' + p.panel + '.'; }
    }
  };

  async function kadessaExecuteAction(action){
    if (!action || !action.type) return null;
    const entry = KADESSA_ACTIONS[action.type];
    if (!entry) return "(Kadessa suggested an action I don't recognize yet: " + action.type + ")";
    try{
      if (entry.risk === 'confirm'){
        const ok = await sarvarcModalConfirm('Let Kadessa do this?', entry.label(action.params || {}), 'Do it');
        if (!ok) return null; // silent cancel, no need to narrate a no-op
      }
      const ran = await entry.run(action.params || {});
      // Build 278: move / layer / overlap actions make choices the reply could not know in
      // advance (an auto-picked opacity, an item kept inside the page), so they hand back a
      // short line to post. Every other action stays silent on success.
      if (ran && typeof ran === 'object' && typeof ran.say === 'string' && ran.say) return ran.say;
      return null; // success is otherwise silent -- the workspace UI updating IS the confirmation
    } catch(e){
      return "Couldn't complete that -- " + (e && e.message ? e.message : 'something went wrong') + ".";
    }
  }

  // GUARD (added after Kadessa was observed building a Form when the person
  // asked for a Table, and occasionally the reverse). Make Forms and Data
  // Arrangement are two completely different modules here -- unlike the
  // navigate_to_panel guard above, where the wrong tool call is a silent
  // no-op, picking mf_create_form instead of da_create_table (or vice
  // versa) actually builds the WRONG artifact and leaves it sitting on
  // screen looking like a real answer. The Worker's own system prompt is
  // the first line of defense (it now spells out the table/columns vs
  // form/fields distinction explicitly -- see the tool-doc comments
  // above), but this is a client-side safety net that doesn't depend on
  // the model getting that right every time: if the user's own words in
  // THIS turn unambiguously named one and only one of "table" / "form"
  // (or a close synonym), and the tool Kadessa picked builds the other one,
  // we refuse to run it rather than silently creating the wrong thing.
  // A message that mentions neither word, or mentions both (e.g. "turn
  // this form's responses into a table" -- a legitimate mf_export_
  // responses_to_da request), is left alone; this only fires on a clean,
  // one-sided mismatch.
  function kadessa_tableFormMismatch(actionType, userText){
    const creates = {
      mf_create_form: 'form', mf_create_from_template: 'form',
      da_create_table: 'table', da_create_table_from_template: 'table'
    };
    const kind = creates[actionType];
    if (!kind) return null;
    const t = String(userText || '').toLowerCase();
    const saysTable = /\btables?\b|\bspreadsheet\b|\btracker\b/.test(t);
    const saysForm  = /\bforms?\b|\bsurveys?\b|\bquestionnaires?\b|\bsign[\s-]?up sheet\b/.test(t);
    if (kind === 'form' && saysTable && !saysForm){
      return "you asked for a table, not a form -- Make Forms and Data Arrangement are different tools here, so I stopped before building the wrong one. Ask again (\"make me a table with ...\") and I'll build it in Data Arrangement instead.";
    }
    if (kind === 'table' && saysForm && !saysTable){
      return "you asked for a form, not a table -- Make Forms and Data Arrangement are different tools here, so I stopped before building the wrong one. Ask again (\"make me a form with ...\") and I'll build it there instead.";
    }
    return null;
  }

  // demoReply(): fallback voice used only when KADESSA_API is off or the Worker
  // is unreachable. Grounded in the SAME getKadessaContext() the real API call
  // uses -- weaves in actual row counts, page numbers, field counts, chart
  // types -- instead of a fixed script that would say the same thing no
  // matter what the user is actually looking at.
  function demoReply(userText, ctx){
    const t = userText.toLowerCase();

    if(t.includes('redact') || t.includes('pii') || t.includes('sensitive')){
      return "Once connected, I'll scan the doc and redact anything sensitive, quick and quiet. Right now I'm just running in demo mode, no live scan yet.";
    }
    if((t.includes('awkward') || t.includes('chart') || t.includes('diagram') || t.includes('shape')) && ctx && ctx.activePanel === 'Diagrams & Graphs'){
      return "Looking at your " + ctx.chartType + " chart with " + (ctx.rowCount != null ? ctx.rowCount : ctx.series.length) + (ctx.rowCount != null ? " rows" : " series") + " -- once I'm fully wired in I can tell you exactly what's off (spacing, overlap, sizing) and offer a fix. Demo mode can flag it but can't push the change yet.";
    }
    if(t.includes('awkward') || t.includes('chart') || t.includes('diagram') || t.includes('shape')){
      return "Noted. Once I'm wired into the diagram data, I can tell you exactly what's off, spacing, overlap, sizing, and offer a fix. Demo mode can't see your canvas yet though.";
    }
    if(t.includes('letterhead') || t.includes('refine') || t.includes('report')){
      return "That's the Refine Report job, tidy the draft, drop it into your letterhead. I'll do that for real once my API connection is live.";
    }
    if(t.includes('mess') && ctx && ctx.activePanel === 'Data Arrangement'){
      return "Your table has " + ctx.totalRowCount + " rows and " + ctx.emptyCellsInSample + " empty cell" + (ctx.emptyCellsInSample === 1 ? '' : 's') + " in the first " + ctx.sampleRows.length + " I can see -- once I'm connected I'll clean those up for real.";
    }
    if(t.includes('mess') && ctx && ctx.activePanel === 'Make Forms'){
      return "\"" + (ctx.formTitle || 'This form') + "\" has " + ctx.fieldCount + " field" + (ctx.fieldCount === 1 ? '' : 's') + " right now -- once I'm connected I'll flag anything missing or malformed.";
    }
    if(t.includes('mess') || t.includes('form')){
      return "I'll flag anything missing or malformed in the data once I'm connected. For now I'm just a placeholder voice, no real check running yet.";
    }
    if(ctx && ctx.activePanel === 'PDF Editor'){
      return "I can see you're on page " + ctx.activePageNumber + " of " + ctx.totalPages + " -- once I'm connected I can act on it directly instead of just talking. Demo mode for now.";
    }
    return "I hear you. I'm running in demo mode right now, so I'm just showing you how I'll sound, not doing real work yet. Add your API connection when you're ready and I'll actually get to it.";
  }

  // Backstop for the "never use em dashes" voice rule. Models reach for
  // em dashes out of habit even when told not to, so this cleans up
  // whatever slips through rather than relying on the prompt alone.
  // "—" (real em dash) and "--" (typed stand-in) both get replaced with
  // a period + space when they're acting as a sentence break, since that
  // reads closest to how the line would've been said in her voice.
  function sarvarcKadessaStripEmDash(text){
    if (!text) return text;
    return String(text)
      .replace(/^[ \t]*\*[ \t]+/gm, '- ')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?=[^*\w]|$)/g, '$1$2')
      .replace(/\*{2,}/g, '')
      .replace(/\s*—\s*/g, '. ')
      .replace(/\s+--\s+/g, '. ')
      .replace(/\.\s*\./g, '.')
      .trim();
  }

  // Kadessa's vision: only these two panels get screenshotted, since these
  // are the ones where seeing the actual page/chart matters (business
  // docs and design), not the data-only panels. containerId points at
  // the element that holds the real rendered content (canvas + any
  // overlays drawn on top of it), so what she sees matches what the user
  // sees, not just the raw canvas pixels underneath annotations.
  // Shared debug popup: opens a new tab showing exactly what image (if
  // any) Kadessa received, so you can check with your own eyes whether the
  // capture is right. Turn on from the console with
  // KADESSA_VISION_DEBUG = true.
  function kadessaVisionDebugPopup(label, dataUrl){
    if (!window.KADESSA_VISION_DEBUG) return;
    const win = window.open();
    if (win) {
      win.document.write(
        '<title>Kadessa vision debug — ' + label + '</title>' +
        '<body style="margin:0;background:#222"><img src="' + dataUrl + '" style="max-width:100%;display:block;margin:auto"></body>'
      );
    }
  }

  async function captureVisionSnapshot(context){
    if (!context) return null;

    // Diagrams & Graphs: read the chart canvas directly instead of
    // html2canvas-ing the container. dgCanvasHolder has two stacked
    // canvases (#dgCanvas for 2D, #dgCanvas3D for WebGL/3D mode), and
    // html2canvas chokes on that combo -- it throws partway through, the
    // try/catch below swallows it, and captureVisionSnapshot silently
    // returned null every time, which is why Kadessa kept saying she had no
    // image. dgGetExportCanvas() already solves this correctly (it's the
    // same function the PNG/JPEG/PDF export buttons use): it forces a
    // fresh WebGL frame and grabs #dgCanvas3D when a 3D chart is active,
    // or composites #dgCanvas plus any placed text overlays onto a clean
    // offscreen canvas otherwise. Reading straight off that instead of
    // screenshotting the DOM sidesteps the whole html2canvas/WebGL issue.
    if (context.activePanel === 'Diagrams & Graphs'){
      try{
        if (typeof dgGetExportCanvas !== 'function') return null;
        const canvas = dgGetExportCanvas();
        if (!canvas) return null;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        kadessaVisionDebugPopup('Diagrams & Graphs', dataUrl);
        return dataUrl;
      } catch(e){
        console.warn('Kadessa vision snapshot failed (Diagrams & Graphs):', e);
        return null;
      }
    }

    // PDF Editor: unchanged -- this path was already working correctly.
    if (context.activePanel === 'PDF Editor'){
      const el = document.getElementById('pdfedCanvasWrap');
      if (!el || el.offsetParent === null) return null; // not currently visible

      try{
        const canvas = await html2canvas(el, { backgroundColor: null, scale: 1, useCORS: true });
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // compressed base64, keeps payload small
        kadessaVisionDebugPopup('PDF Editor', dataUrl);
        return dataUrl;
      } catch(e){
        console.warn('Kadessa vision snapshot failed (PDF Editor):', e);
        return null;
      }
    }

    return null; // not a vision-enabled panel, skip entirely
  }

  async function callRealKadessaAPI(messages, context){
    // Grab the user's current Supabase login token so the Worker can verify
    // who's asking (never trust a client-supplied user id).
    let accessToken = '';
    try{
      const { data: { session } } = await sarvarcSupabase.auth.getSession();
      accessToken = session ? session.access_token : '';
    } catch(e){ /* not signed in, or Supabase not ready yet */ }

    // Only fires for Diagrams & Graphs / PDF Editor; null everywhere else.
    const snapshot = await captureVisionSnapshot(context);

    const response = await fetch(KADESSA_API.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      // FIX: SYSTEM_PROMPT no longer lives in this file or gets sent
      // here. Kadessa's personality and instructions now live only inside
      // the kadessa-backend Worker, so they never reach the browser at all
      // (not in View Source, not in this request payload).
      body: JSON.stringify({ messages: messages, context: context, image: snapshot })
    });
    const data = await response.json();
    // actions: prefer the new multi-action array; fall back to wrapping
    // the legacy single `action` field so this still works against an
    // older Worker deploy that hasn't been updated yet.
    const actions = Array.isArray(data.actions) ? data.actions : (data.action ? [data.action] : []);
    return {
      reply: data.reply || "Sorry, I didn't catch that -- mind trying again?",
      actions: actions
    };
  }

  // Dedicated one-off vision-OCR request, kept entirely separate from the
  // normal chat turn (callRealKadessaAPI above). Used only by
  // pdfed_vision_reread_page, itself only reachable after a local OCR read
  // already came back uncertain -- so this is never the default path, only
  // the deliberate paid fallback. Sends the ACTUAL page image (passed in by
  // the caller, already captured by pdfedReadPageForKadessa) rather than the
  // ambient low-res screenshot captureVisionSnapshot attaches to ordinary
  // turns, plus the prior local-OCR text as a rough starting point the model
  // can cross-check against instead of transcribing fully blind, which tends
  // to help on partially legible scans. No `messages`/`context`/tools here --
  // this isn't a conversational turn, it's a single transcription request,
  // so the Worker should route it straight to GPT-5.6 Luna's vision input
  // with an instruction to transcribe exactly (no summarizing, no
  // paraphrasing) and hand the transcription straight back as plain text.
  async function callKadessaVisionOcr(dataUrl, priorOcrText){
    let accessToken = '';
    try{
      const { data: { session } } = await sarvarcSupabase.auth.getSession();
      accessToken = session ? session.access_token : '';
    } catch(e){ /* not signed in, or Supabase not ready yet */ }

    const response = await fetch(KADESSA_API.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken
      },
      body: JSON.stringify({
        mode: 'vision_ocr',
        image: dataUrl,
        priorOcrText: priorOcrText || ''
      })
    });
    const data = await response.json();
    return data.text || '';
  }

  // -----------------------------------------------------------------
  // EYES-ON-IT BACKGROUND WATCHER
  // -----------------------------------------------------------------
  // The Worker already ships a full "eyes" mode (mode: 'eyes') that
  // fingerprints each current layout issue and only tells us about one
  // once it's persisted across several checks -- and SYSTEM_PROMPT above
  // spends a whole paragraph telling Kadessa how to speak once that happens.
  // But nothing ever actually CALLED that endpoint: without this, Kadessa
  // could only ever mention layoutIssues passively, on a turn the person
  // started themselves. This loop is what makes the unprompted "got eyes
  // on it" behavior real.
  //
  // Runs on a plain timer rather than hooking every one of PDF Editor's
  // many edit call sites -- the Worker's own KV counter is what enforces
  // "persisted across several checks", so evenly spaced polling satisfies
  // that contract exactly as well as an edit-by-edit hook would, without
  // touching dozens of unrelated functions. Scoped to PDF Editor client-
  // side too (not just relying on the Worker's own no-op for other
  // panels) so a tick outside that panel never even makes a network call.
  const KADESSA_EYES_INTERVAL_MS = 6000;
  const KADESSA_EYES_SCOPE_ID = (function(){
    try { return crypto.randomUUID(); } catch(e){ return 'sc_' + Date.now() + '_' + Math.random().toString(36).slice(2); }
  })();
  let kadessaEyesBusy = false;
  // Held here instead of shown immediately when the panel is closed --
  // flushed into the thread (and the badge cleared) the moment the person
  // opens Kadessa, so a background flag is deferred, never lost.
  let kadessaEyesPendingProactive = [];

  function kadessaEyesShowBadge(show){
    launcher.classList.toggle('kadessa-has-proactive', !!show);
  }

  async function kadessaEyesTick(){
    if (kadessaEyesBusy) return; // never overlap with a check already in flight
    if (document.hidden) return; // don't spend calls on a backgrounded tab
    if (!KADESSA_API.enabled) return; // demo mode has no Worker to ask
    if (launcher.style.display === 'none') return; // not signed in

    const ctx = getKadessaContext();
    if (!ctx || ctx.activePanel !== 'PDF Editor') return; // the only panel with real layoutIssues today
    if (!Array.isArray(ctx.layoutIssues)) return;

    kadessaEyesBusy = true;
    try{
      let accessToken = '';
      try{
        const { data: { session } } = await sarvarcSupabase.auth.getSession();
        accessToken = session ? session.access_token : '';
      } catch(e){ /* not signed in / Supabase not ready */ }
      if (!accessToken) return;

      const response = await fetch(KADESSA_API.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken },
        body: JSON.stringify({ mode: 'eyes', scopeId: KADESSA_EYES_SCOPE_ID, context: ctx })
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data || !data.proactive) return;

      const text = sarvarcKadessaStripEmDash(data.proactive);
      // This wasn't a real conversational turn, so it's kept out of
      // `history` (the OpenAI-facing transcript) -- but it still needs to
      // be visible: shown right away if the panel's already open, held
      // and badged if it's closed.
      if (panel.classList.contains('open')){
        addMsg('kadessa', text);
      } else {
        kadessaEyesPendingProactive.push(text);
        kadessaEyesShowBadge(true);
      }
    } catch(e){
      // Silent -- a background watcher's network hiccup shouldn't ever
      // interrupt the person's actual work with a visible error.
    } finally {
      kadessaEyesBusy = false;
    }
  }

  setInterval(kadessaEyesTick, KADESSA_EYES_INTERVAL_MS);

  // Builds the lightweight, LLM-facing summary of the WHOLE batch that's
  // staged -- never the raw dataUrl (that would blow up the request size
  // for no reason the model needs), just enough for Kadessa to reason about
  // and act on each piece: for a logo, its name and the accent color
  // already extracted from it; for data, the same dataset-summary shape
  // Data Arrangement's own context uses, so Kadessa treats an attached file
  // the same way she'd treat a table pasted in by hand. Returns an ARRAY
  // (one entry per staged file, plus one entry per sheet for a multi-sheet
  // workbook) so a "logo + excel + Word doc" drop reads to Kadessa as one
  // batch she can act on together, not three separate one-file turns.
  function kadessaAttachmentContextSummary(){
    if (!kadessaPendingAttachments.length) return null;
    const out = [];
    let remaining = KADESSA_TURN_MAX_CHARS; // shared text budget across every file this turn
    kadessaPendingAttachments.forEach(function(a){
      if (a.kind === 'logo'){
        out.push({
          kind: 'logo',
          name: a.name,
          accentColor: pdfedRefineState.logoAccent || null
        });
        return;
      }
      // sampleRows carries the actual cell content (up to 15 rows), not just
      // a count -- mirrors the shape getKadessaContext() already sends when the
      // person is just browsing Data Arrangement (see the 'dataarrange'
      // branch above). Without this, an attached Word/Excel file only ever
      // told Kadessa a row count and header list -- she never saw a single word
      // or number that was actually in the file, so she couldn't reason
      // about the content itself (only its shape). This is what lets her
      // genuinely read a report's paragraphs or a spreadsheet's figures the
      // moment they're attached, the same way she reads a table someone
      // pastes into Data Arrangement by hand.
      // File-level fields (the file's real text) ride on the FIRST entry for
      // that file only, so a multi-sheet workbook does not repeat its text
      // once per sheet. The Worker lifts fileContent out into its own
      // delimited block for the model.
      let content = a.fileContent || '';
      let cut = !!a.contentTruncated;
      if (content){
        const allowed = Math.max(2000, remaining);
        if (content.length > allowed){ content = content.slice(0, allowed); cut = true; }
        remaining -= content.length;
      }
      const fileFields = {
        fileType: a.fileType || null,
        fileContent: content || undefined,
        contentTruncated: content ? cut : undefined,
        charCount: a.charCount || undefined,
        fileStats: a.fileStats || undefined,
        readNote: a.readNote || undefined
      };
      const datasets = a.datasets || [];
      if (!datasets.length){
        out.push(Object.assign({ kind: 'data', name: a.name }, fileFields));
        return;
      }
      datasets.forEach(function(ds, i){
        out.push(Object.assign({
          kind: 'data',
          name: a.name,
          datasetName: ds.name,
          headers: ds.headers || [],
          rowCount: (ds.rows || []).length,
          // When the full text is attached, 5 sample rows are enough to
          // keep the dataset name/shape; the text carries the content.
          sampleRows: (ds.rows || []).slice(0, content ? 5 : 15)
        }, i === 0 ? fileFields : { fileType: a.fileType || null }));
      });
    });
    return out;
  }

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    let text = input.value.trim();
    if(!text && !kadessaPendingAttachments.length) return;
    if(!text && kadessaPendingAttachments.length){
      // No caption typed -- synthesize a sensible default so the turn
      // still reads naturally in the thread instead of sending nothing.
      // A single file gets its old, specific phrasing; a batch (the "here's
      // everything, you handle it" case this exists for) names every piece
      // so it's obvious in the thread what actually traveled with the turn.
      // Only a logo + content batch is a clear "build the finished report"
      // ask. A lone Word/Excel file (or several content files with no
      // logo) says nothing about intent, so it gets a neutral caption and
      // Kadessa reads the file and works out (or asks) what it is for.
      const hasLogo = kadessaPendingAttachments.some(function(a){ return a.kind === 'logo'; });
      const hasData = kadessaPendingAttachments.some(function(a){ return a.kind === 'data'; });
      const names = kadessaPendingAttachments.map(function(a){ return a.name; }).join(', ');
      if (kadessaPendingAttachments.length === 1){
        text = hasLogo ? "Here's our logo, use it." : "Here's " + names + ".";
      } else if (hasLogo && hasData){
        text = "Here's " + names + ". Put together the finished report.";
      } else {
        text = "Here are " + names + ".";
      }
    }

    // Snapshot now -- kadessaClearAttachments() (in `finally` below) wipes
    // kadessaPendingAttachments once the turn is sent, but the bubble in the
    // thread needs to go on showing exactly what traveled with it.
    const sentAttachments = kadessaPendingAttachments.slice();
    addMsg('user', text, sentAttachments);
    history.push({ role: 'user', content: text });
    input.value = '';
    sendBtn.disabled = true;

    // Pull real workspace state ONCE per turn so the thinking indicator,
    // the live API call, and the demo fallback all reason about the exact
    // same snapshot of reality instead of drifting out of sync with each other.
    const attachmentSummary = kadessaAttachmentContextSummary();
    // Files from EARLIER turns (not re-attached now) stay available, so a
    // follow-up like "now turn that into slides" still has the document.
    const recentFilesCtx = kadessaRecentFilesContext(sentAttachments.map(function(a){ return a.name; }));
    let ctx = kadessaDecorateContext(getKadessaContext(), attachmentSummary, recentFilesCtx);
    kadessaRememberAttachments(sentAttachments);
    const thinking = addThinkingMsg(ctx);

    try{
      let reply, actions = [];
      if(KADESSA_API.enabled){
        const result = await callRealKadessaAPI(history, ctx);
        reply = result.reply;
        actions = result.actions;
      } else {
        await new Promise(function(r){ setTimeout(r, 500); });
        reply = demoReply(text, ctx);
      }
      reply = sarvarcKadessaStripEmDash(reply);
      resolveThinkingMsg(thinking, reply);
      history.push({ role: 'assistant', content: reply });
      // Run every action the model asked for, in order (e.g. set X-axis,
      // then Y-axis, then chart type all in one turn) rather than only
      // the first -- a single request can legitimately need several
      // small, sequential state changes to finish. The acting indicator
      // (sharp scan ring + snap on the launcher, badge in the header)
      // covers exactly this span -- it's off the rest of the time,
      // including while she's just talking.
      // Runs a batch of actions in order. Returns true if one of them was a
      // successful panel switch, so the caller knows Kadessa is now standing in
      // a different panel with a different set of tools.
      async function kadessaRunActionBatch(list, userText){
        let switched = false;
        if (!list || !list.length) return switched;
        kadessaSetActing(true);
        try{
          for (const action of list){
            kadessaPulseActing();
            const mismatch = kadessa_tableFormMismatch(action && action.type, userText);
            const problem = mismatch || await kadessaExecuteAction(action);
            if (problem) addMsg('kadessa', sarvarcKadessaStripEmDash(problem));
            else if (action && action.type === 'navigate_to_panel') switched = true;
          }
        } finally {
          kadessaSetActing(false);
        }
        return switched;
      }

      let kadessaSwitched = await kadessaRunActionBatch(actions, text);

      // FIX (smarter asks): the Worker only hands Kadessa the tools for the panel
      // you're standing in, so before this she could switch panels and then
      // STOP, leaving the real request undone. Now, after a panel switch, she
      // is automatically asked to carry on with the original request from the
      // new panel, where her tools now exist. Capped at 2 hops so it can never
      // loop. Wrapped in its own try/catch so a hiccup here never overwrites
      // the reply that already showed.
      try{
        let hops = 0;
        while (kadessaSwitched && hops < 2){
          hops++;
          kadessaSwitched = false;
          await new Promise(function(r){ setTimeout(r, 700); }); // let the new panel finish drawing
          const ctx2 = kadessaDecorateContext(getKadessaContext(), attachmentSummary, recentFilesCtx);
          const followUp = { role: 'user', content: "(automatic follow-up) You just switched me to a new panel. Now finish my original request here using the tools you have in this panel. Do not switch panels again unless it is truly needed. If part of it truly cannot be done, do the closest useful thing and say what is left for me to do by hand." };
          const res2 = await callRealKadessaAPI(history.concat([followUp]), ctx2);
          const reply2 = sarvarcKadessaStripEmDash(res2.reply || '');
          if (reply2){ addMsg('kadessa', reply2); history.push({ role: 'assistant', content: reply2 }); }
          kadessaSwitched = await kadessaRunActionBatch(res2.actions, text);
        }
      } catch(e2){
        console.warn('Kadessa auto-continue after panel switch failed', e2);
      }
    } catch(err){
      resolveThinkingMsg(thinking, "Couldn't reach the server just now. Mind trying again?");
    } finally {
      sendBtn.disabled = false;
      input.focus();
      // One-shot: this batch traveled with this message only. Whatever it
      // did (logo set, data imported) already happened and stays; only the
      // "tell Kadessa about it" chips are cleared.
      kadessaClearAttachments();
    }
  });


  input.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      form.requestSubmit();
    }
  });

})();
