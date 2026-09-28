# Optional AbleSci request workflow

AbleSci is an optional per-user fallback, never a universal default. Read `fallback` from `profile.json` and respect the current user's request. The user completes AbleSci login manually in their existing browser. Do not submit a request or spend points unless the profile explicitly enables automatic requests with a reward and per-run cap, or the user authorizes this request directly.

## Publish a request

1. Confirm the paper's DOI, title, and official publisher URL. Check the configured institution and open-access routes first, or record why they are unavailable.
2. Open the AbleSci request form in the existing browser session. Fill the paper fields and the user-configured reward. Do not infer a reward from this reference.
3. Before submission, check `points_spent_this_run + reward_points <= max_points_per_run` for capped automatic mode. A `null` cap is valid only when the user explicitly chose unlimited automatic requests during setup. Stop when the cap would be exceeded. Submit only once and record the resulting detail URL and `求助中` state.
4. A request is pending, not a downloaded PDF. Report the link separately from verified files.

## Collect and accept a fulfilled file

1. On `待确认`, download through the channel chosen by the user or saved in the user's own preferences. Locate the completed file in the actual browser download directory; never assume a machine-specific path.
2. Verify `%PDF-`, page count, DOI or title, and final destination before acceptance. If wrong or inconclusive, leave it unaccepted and report why.
3. When verification passes, click `采纳文件`; confirm the `layui-layer` dialog (`A.layui-layer-btn0`) and dismiss the success dialog. Confirm that the detail page changes to `【已完结】`.

## Assisting another user

Assistance is a separate task and requires the current user's authorization. Use only a PDF the user is entitled to provide. Read the request DOI, fetch and verify the correct PDF, upload it via the existing control daemon's `/setFiles` and page upload control, and confirm success. Remove temporary assist originals after a successful upload if that is the user's configured preference. Points are awarded only when the requester accepts the file.

Site labels and selectors are historical observations; inspect the current page before acting.
