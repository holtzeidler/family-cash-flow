/** Primary action on the public sample forecast. No network and no account creation. */

function sampleForecastCta(signedIn, onboardingState) {
  if (!signedIn) {
    return { href: "/account-setup/?fresh=1", label: "Create my forecast" };
  }
  if (onboardingState === "done") {
    return { href: "/calendar/", label: "Go to my forecast" };
  }
  return { href: "/account-setup/?resume=1", label: "Continue setting up my forecast" };
}
