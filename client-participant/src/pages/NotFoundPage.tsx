import { Link } from 'react-router';

export function NotFoundPage({
  title = 'Page not found',
  message = "There's nothing at this address.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <section className="panel empty">
      <p className="mono muted">404</p>
      <h1>{title}</h1>
      <p className="muted">{message}</p>
      <Link to="/" className="button ghost">
        Back to events
      </Link>
    </section>
  );
}
