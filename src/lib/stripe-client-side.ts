import { type Stripe, loadStripe } from "@stripe/stripe-js"
import { env } from "~/env"

let stripePromise: Promise<Stripe | null> | undefined
export const getStripe = () => {
    if (!stripePromise) {
        stripePromise = loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
    }
    return stripePromise
}
