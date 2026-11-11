import { h as rawH, render, Fragment, createRef } from '/vendor/preact.mjs';
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useErrorBoundary } from '/vendor/hooks.mjs';
import htm from '/vendor/htm.mjs';
import { tx } from '/shared/i18n.js';

// Langue : chaque texte écrit dans un gabarit (nœud de texte, title, placeholder…) passe par le
// dictionnaire de la langue choisie. Le français est la langue source ; une chaîne absente du
// dictionnaire s'affiche telle quelle. Les valeurs des champs (value) ne sont jamais traduites.
const PROPS = ['title', 'placeholder', 'aria-label', 'alt', 'label', 'text', 'ok', 'submitLabel', 'sub'];

function h(type, props, ...children) {
  if (props) {
    for (const k of PROPS) {
      if (typeof props[k] === 'string') props[k] = tx(props[k]);
    }
  }
  for (let i = 0; i < children.length; i++) if (typeof children[i] === 'string') children[i] = tx(children[i]);
  return rawH(type, props, ...children);
}

export const html = htm.bind(h);
export { h, render, Fragment, createRef, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useErrorBoundary };
