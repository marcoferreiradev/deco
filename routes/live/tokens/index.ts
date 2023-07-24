/// <reference lib="deno.unstable" />

import { JwtPayload, newJwksIssuer } from "$live/deps.ts";
import { context } from "$live/live.ts";
import { verify } from "https://denopkg.com/deco-cx/durable@0.5.0/djwt.js";

// @ts-ignore as `Deno.openKv` is still unstable.
const kvPromise = Deno.openKv?.().catch((e) => {
  console.error(e);

  return null;
});

const matchPart = (urnPart: string, otherUrnPart: string) =>
  urnPart === "*" || otherUrnPart === urnPart;
const matchParts = (urn: string[], resource: string[]) => {
  return urn.every((part, idx) => matchPart(part, resource[idx]));
};
const matches = (urnParts: string[]) => (resourceUrn: string) => {
  const resourceParts = resourceUrn
    .split(":");
  const lastIdx = resourceParts.length - 1;
  return resourceParts.every((part, idx) => {
    if (part === "*") {
      return true;
    }
    if (lastIdx === idx) {
      return matchParts(part.split("/"), urnParts[idx].split("/"));
    }
    return part === urnParts[idx];
  });
};
const trustedIssuers: string[] = [
  "urn:deco:site:*:admin:deployment/*",
];

const siteFromUrn = (urn: string) => {
  return urn.split(":")[4];
};
const siteUrn = (site: string) => `urn:deco:site:*:${site}:deployment/*`;
const isAllowed = (site: string, jwt: JwtPayload): boolean => {
  const { iss, sub, exp } = jwt;
  if (!iss || !sub) {
    return false;
  }
  if (!trustedIssuers.some(matches(iss.split(":")))) {
    return false;
  }
  if (exp && new Date(exp) <= new Date()) {
    return false;
  }
  const matchWithSite = matches(sub.split(":"));
  return matchWithSite(siteUrn(site));
};

const ADMIN_PUBLIC_KEY =
  "eyJrdHkiOiJSU0EiLCJhbGciOiJSUzI1NiIsIm4iOiJ1N0Y3UklDN19Zc3ljTFhEYlBvQ1pUQnM2elZ6VjVPWkhXQ0M4akFZeFdPUnByem9WNDJDQ1JBVkVOVjJldzk1MnJOX2FTMmR3WDlmVGRvdk9zWl9jX2RVRXctdGlPN3hJLXd0YkxsanNUbUhoNFpiYXU0aUVoa0o1VGNHc2VaelhFYXNOSEhHdUo4SzY3WHluRHJSX0h4Ym9kQ2YxNFFJTmc5QnJjT3FNQmQyMUl4eUctVVhQampBTnRDTlNici1rXzFKeTZxNmtPeVJ1ZmV2Mjl0djA4Ykh5WDJQenp5Tnp3RWpjY0lROWpmSFdMN0JXX2tzdFpOOXU3TUtSLWJ4bjlSM0FKMEpZTHdXR3VnZGpNdVpBRnk0dm5BUXZzTk5Cd3p2YnFzMnZNd0dDTnF1ZE1tVmFudlNzQTJKYkE3Q0JoazI5TkRFTXRtUS1wbmo1cUlYSlEiLCJlIjoiQVFBQiIsImtleV9vcHMiOlsidmVyaWZ5Il0sImV4dCI6dHJ1ZX0=";
const jwksIssuer = newJwksIssuer({
  fallbackPublicKey: ADMIN_PUBLIC_KEY,
  remoteAddress: "https://deco.cx/.well_known/jwks.json",
});

const tokenChannel = new BroadcastChannel(`deco_tokens`);

export const handler = async (req: Request) => {
  const kv = await kvPromise;
  if (!kv) {
    return Response.json({ error: "kv is not available" }, { status: 400 });
  }
  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return new Response(null, { status: 401 });
  }
  const [_, authToken] = authorization.split(" ");
  if (!authToken) {
    return new Response(null, { status: 401 });
  }

  const payload: JwtPayload = await jwksIssuer.verifyWith((key) =>
    verify(authToken, key)
  ).catch((err) => {
    console.log("err when verifying token", err);
    return {};
  });

  if (!isAllowed("admin", payload)) {
    return new Response(null, { status: 403 });
  }

  const { token } = await req.json();

  const issuedTokenPayload: JwtPayload = await jwksIssuer.verifyWith((key) =>
    verify(token, key)
  ).catch((err) => {
    console.log("err when verifying issued token", err);
    return {};
  });

  if (!isAllowed(context.site, issuedTokenPayload)) {
    return new Response(null, { status: 400 });
  }

  const issuer = siteFromUrn(issuedTokenPayload.iss!);

  const result = await kv.set(
    ["tokens", issuer],
    token,
  );
  tokenChannel.postMessage({ issuer, token });
  if (!result.ok) {
    return Response.json({ error: "deno kv error", code: 500 }, {
      status: 500,
    });
  }
  return new Response(null, { status: 204 });
};
