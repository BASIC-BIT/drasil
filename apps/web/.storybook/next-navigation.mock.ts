const router = {
  back: () => undefined,
  forward: () => undefined,
  prefetch: async () => undefined,
  push: () => undefined,
  refresh: () => undefined,
  replace: () => undefined,
};

export function useRouter() {
  return router;
}

export function usePathname(): string {
  return '/storybook';
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useParams(): Readonly<Record<string, string>> {
  return {};
}

export function notFound(): never {
  throw new Error('notFound() is not available in Storybook.');
}

export function redirect(path: string): never {
  throw new Error(`redirect(${path}) is not available in Storybook.`);
}
