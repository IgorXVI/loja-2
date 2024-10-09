import "server-only"

import Stripe from "stripe"

import { env } from "../env"
import { auth, clerkClient } from "@clerk/nextjs/server"
import { db } from "./db"
import { type Prisma } from "prisma/prisma-client"
import { calcShippingFee } from "./shipping-api"
import { createShippingTicket } from "~/server/shipping-api"

const cClient = clerkClient()

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
})

type ProductData = {
    name: string
    price: number
    mainImg: string
}

export const createProduct = async (productData: ProductData) => {
    const [product] = await Promise.allSettled([
        stripe.products.create({
            name: productData.name,
            images: [productData.mainImg],
            default_price_data: {
                currency: "brl",
                unit_amount: productData.price * 100,
            },
            shippable: true,
        }),
    ])

    if (product.status === "rejected") {
        return {
            success: false,
            message: `Failed to create product: ${product.reason}`,
            productId: "",
        }
    }

    return {
        success: true,
        message: "Product created successfully",
        productId: product.value.id,
    }
}

export const archiveProduct = async (stripeId: string) => {
    const [archivedProduct] = await Promise.allSettled([
        stripe.products.update(stripeId, {
            active: false,
        }),
    ])

    if (archivedProduct.status === "rejected") {
        return {
            success: false,
            message: `Failed to archive product with id "${stripeId}": ${archivedProduct.reason}`,
        }
    }

    return {
        success: true,
        message: `Product with id "${stripeId}" archived successfully`,
    }
}

export const restoreProduct = async (stripeId: string) => {
    const [archivedProduct] = await Promise.allSettled([
        stripe.products.update(stripeId, {
            active: true,
        }),
    ])

    if (archivedProduct.status === "rejected") {
        return {
            success: false,
            message: `Failed to restore product with id "${stripeId}": ${archivedProduct.reason}`,
        }
    }

    return {
        success: true,
        message: `Product with id "${stripeId}" restored successfully`,
    }
}

export const createCheckoutSession = async (inputProducts: { stripeId: string; quantity: number }[]) => {
    const user = auth()

    if (!user.userId) {
        return {
            success: false,
            message: `User is not authorized.`,
        }
    }

    const userAddress = await db.address.findUnique({
        where: {
            userId: user.userId,
        },
    })

    if (!userAddress) {
        return {
            success: false,
            message: `User has no address.`,
        }
    }

    const books = await db.book.findMany({
        where: {
            stripeId: {
                in: inputProducts.map((p) => p.stripeId),
            },
        },
        select: {
            id: true,
            title: true,
            price: true,
            stripeId: true,
            weightGrams: true,
            widthCm: true,
            heightCm: true,
            thicknessCm: true,
        },
    })

    const booksMap = new Map<
        string,
        {
            id: string
            title: string
            price: Prisma.Decimal
            stripeId: string
            weightGrams: number
            widthCm: number
            heightCm: number
            thicknessCm: number
        }
    >()

    books.forEach((book) => {
        booksMap.set(book.stripeId, book)
    })

    const products = inputProducts.filter((p) => booksMap.get(p.stripeId))

    const productQuantityMap = new Map<string, number>()
    products.forEach((product) => {
        productQuantityMap.set(product.stripeId, product.quantity)
    })

    const [stripeProducts] = await Promise.allSettled([
        stripe.products.list({
            ids: [...productQuantityMap.keys()],
            limit: products.length,
        }),
    ])

    if (stripeProducts.status === "rejected") {
        return {
            success: false,
            message: `Failed to fetch products: ${stripeProducts.reason}`,
        }
    }

    const lineItems = stripeProducts.value.data.map((sp) => ({
        price: sp.default_price?.toString() ?? "",
        quantity: productQuantityMap.get(sp.id),
    }))

    const shipping = await calcShippingFee({
        toPostalCode: userAddress.cep,
        products: stripeProducts.value.data.map((sp) => ({
            quantity: productQuantityMap.get(sp.id)!,
            height: booksMap.get(sp.id)!.heightCm,
            width: booksMap.get(sp.id)!.widthCm,
            length: booksMap.get(sp.id)!.thicknessCm,
            weight: (booksMap.get(sp.id)!.weightGrams ?? 0) / 1000,
        })),
    }).then((arr) => {
        if (arr.length === 0) {
            return undefined
        }

        const arrSorted = arr.sort((a, b) => a.delivery_range.max - b.delivery_range.max)

        return arrSorted[0]
    })

    if (!shipping) {
        throw new Error("Not able to fetch shipping prices.")
    }

    const [checkoutSession] = await Promise.allSettled([
        stripe.checkout.sessions.create({
            mode: "payment",
            currency: "brl",
            line_items: lineItems,
            success_url: `${env.URL}/commerce/payment-success/{CHECKOUT_SESSION_ID}`,
            cancel_url: `${env.URL}/commerce/payment-canceled/{CHECKOUT_SESSION_ID}`,
            locale: "pt-BR",
            shipping_options: [
                {
                    shipping_rate_data: {
                        type: "fixed_amount",
                        metadata: {
                            serviceId: shipping.id,
                        },
                        display_name: shipping.name,
                        delivery_estimate: {
                            minimum: {
                                unit: "business_day",
                                value: shipping.delivery_range.min,
                            },
                            maximum: {
                                unit: "business_day",
                                value: shipping.delivery_range.max,
                            },
                        },
                        fixed_amount: {
                            amount: Math.ceil(shipping.price * 100),
                            currency: "brl",
                        },
                    },
                },
            ],
        }),
    ])

    if (checkoutSession.status === "rejected") {
        return {
            success: false,
            message: `Failed to create checkout session: ${checkoutSession.reason}`,
        }
    }

    const session = checkoutSession.value

    const productsForOrderShipping = products.map((product) => ({
        bookDBId: booksMap.get(product.stripeId)?.id ?? "N/A",
        name: booksMap.get(product.stripeId)?.title ?? "N/A",
        quantity: product.quantity,
        unitary_value: booksMap.get(product.stripeId)?.price.toNumber() ?? 0,
    }))

    const userData = await cClient.users.getUser(user.userId)

    const ticketId = await createShippingTicket({
        to: {
            name: `${userData.firstName} ${userData.lastName}`,
            address: `${userAddress.street}, número ${userAddress.number}${userAddress.complement ? `, ${userAddress.complement}` : ""}`,
            district: userAddress.neighborhood,
            city: userAddress.city,
            state_abbr: userAddress.state,
            postal_code: userAddress.cep,
            email: userData.primaryEmailAddress?.emailAddress ?? "N/A",
        },
        service: shipping.id,
        products: productsForOrderShipping,
        volumes: { ...shipping.packages[0].dimensions, weight: shipping.packages[0].weight },
        tag: JSON.stringify({ sessionId: session.id, userId: user.userId }),
    })

    await db.order.create({
        data: {
            userId: user.userId,
            sessionId: session.id,
            ticketId,
            totalPrice: session.amount_total! / 100,
            shippingPrice: shipping.price,
            shippingServiceId: shipping.id.toString(),
            shippingServiceName: shipping.name,
            shippingDaysMin: shipping.delivery_range.min,
            shippingDaysMax: shipping.delivery_range.max,
            BookOnOrder: {
                createMany: {
                    data: productsForOrderShipping.map((sp) => ({
                        bookId: sp.bookDBId,
                        price: sp.unitary_value,
                    })),
                },
            },
        },
    })

    return {
        success: true,
        message: "Checkout session created successfully",
        url: checkoutSession.value.url,
    }
}
