// Copyright 2020 The Cockroach Authors.
//
// Use of this software is governed by the Business Source License
// included in the file licenses/BSL.txt.
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0, included in the file
// licenses/APL.txt.

import { get, isString, isNumber } from "lodash";
import { createSandbox } from "sinon";
import { track } from "./trackSearch";

const sandbox = createSandbox();

describe("trackSearch", () => {
  const testSearchResults = 3;

  afterEach(() => {
    sandbox.reset();
  });

  it("should only call track once", () => {
    const spy = sandbox.spy();
    track(spy)(testSearchResults);
    expect(spy.calledOnce).toBe(true);
  });

  it("should send the right event", () => {
    const spy = sandbox.spy();
    const expected = "Search";

    track(spy)(testSearchResults);

    const sent = spy.getCall(0).args[0];
    const event = get(sent, "event");

    expect(isString(event)).toBe(true);
    expect(event === expected).toBe(true);
  });

  it("should send the correct payload", () => {
    const spy = sandbox.spy();

    track(spy)(testSearchResults);

    const sent = spy.getCall(0).args[0];
    const numberOfResults = get(sent, "properties.numberOfResults");

    expect(isNumber(numberOfResults)).toBe(true);
    expect(numberOfResults === testSearchResults).toBe(true);
  });
});
