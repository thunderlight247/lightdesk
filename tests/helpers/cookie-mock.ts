/** In-memory stand-in for next/headers cookies(), shared across a test file. */
export const cookieStore = new Map<string, string>();

export const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
    has: (name: string) => cookieStore.has(name),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
};
