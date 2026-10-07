import type { BrowserAction, BrowserReply } from './protocol';

type ErrorCode = NonNullable<BrowserReply['errorCode']>;

// Browser errors may contain local paths, command lines, URLs and page contents.
// Keep that diagnostic text out of the webview; only authored guidance crosses IPC.
export class SelectorError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly title: string,
    message: string,
    readonly retryable = true,
    readonly browserName?: string,
  ) {
    super(message);
  }
}

export function selectorErrorReply(
  error: unknown,
  action?: BrowserAction,
  browserName?: string,
): Omit<BrowserReply, 'id'> {
  if (error instanceof SelectorError) {
    return {
      error: error.message,
      errorCode: error.code,
      errorTitle: error.title,
      retryable: error.retryable,
      browserName: error.browserName ?? browserName,
    };
  }

  const detail = error instanceof Error ? error.message : '';
  const navigating = action && ['navigate', 'back', 'forward', 'reload'].includes(action.type);
  let message = 'The page could not complete this action. Try again or reopen the website.';
  if (/Target page, context or browser has been closed|Browser closed|disconnected/i.test(detail)) {
    message = 'The browser session ended. Open the website again to reconnect.';
  } else if (navigating) {
    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(detail))
      message = 'The website address could not be found. Check the address and your connection.';
    else if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(detail))
      message =
        'The website refused the connection. For a local app, start its development server and try again.';
    else if (/ERR_CERT_|SSL_ERROR|certificate/i.test(detail))
      message =
        'The website certificate could not be verified. Check its HTTPS configuration before retrying.';
    else if (/Timeout|timed out/i.test(detail))
      message = 'The website took too long to respond. Check your connection, then try again.';
    else
      message =
        'The website could not be opened. Check the address and your connection, then try again.';
  } else if (/Timeout|timed out/i.test(detail)) {
    message = 'The page took too long to respond. Wait for it to finish loading and try again.';
  }
  return {
    error: message,
    errorCode: navigating ? 'navigation' : 'action',
    errorTitle: navigating ? 'Could not open website' : 'Action could not finish',
    retryable: true,
    browserName,
  };
}
