import Conf from 'conf';

interface ConfigSchema {
  githubToken: string;
}

const config = new Conf<ConfigSchema>({
  projectName: 'cherrypick-terminal',
  schema: {
    githubToken: {
      type: 'string',
      default: '',
    },
  },
});

export function getSavedToken(): string {
  return config.get('githubToken') ?? '';
}

export function saveToken(token: string): void {
  config.set('githubToken', token);
}

export function clearToken(): void {
  config.delete('githubToken');
}

export function hasToken(): boolean {
  const t = getSavedToken();
  return typeof t === 'string' && t.length > 0;
}
