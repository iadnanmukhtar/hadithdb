# Email subscriptions and in-app alerts

Readers manage email delivery by category and author. In-app alerts have their own unread state.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Set email preferences | One Settings-style page groups the master switch, notification categories and author subscriptions. Back opens the originating Settings disclosure. | Delivery checks the recipient’s current choices. Notes and articles share the articles preference and require a corresponding author email subscription. Disabling email leaves follows and in-app activity in place. |
| Unsubscribe | A link in a message leads to a category-specific confirmation. The email also offers access to preferences. | A GET displays confirmation and POST applies the opt-out, including one-click requests. Author subscription and category opt-outs have distinct scopes. |
| Read in-app alerts | An unread count accompanies Following. Opening alerts lets the user navigate to the source and mark items read. | Account-scoped alerts track unread state independently of email delivery. |

## Following a request

A reader who follows a writer can turn off article emails and continue using Following. When a publication email is missing, check the author subscription and the notes/articles category. Delivery checks preferences again before sending queued mail.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Email preferences · signed out | `/community/email-preferences` | [Wide](../../design-system/screens/preferences-wide.jpg) | [Narrow](../../design-system/screens/preferences-small.jpg) |

## Implementation and related reading

- Recipient preferences and unsubscribe behavior. [lib/NotificationPreferences.js](../../../lib/NotificationPreferences.js)
- Delivery-time checks. [lib/NotificationDelivery.js](../../../lib/NotificationDelivery.js)
- In-app unread state. [lib/CommunityAlerts.js](../../../lib/CommunityAlerts.js)
- Shared HTML and plain-text email layout. [lib/NotificationEmail.js](../../../lib/NotificationEmail.js)

Related guides · [ActivityPub federation](../federation/README.md)

[All features](../README.md)
