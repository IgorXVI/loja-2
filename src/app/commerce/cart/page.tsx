"use client"

import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Minus, Plus, Trash2 } from "lucide-react"

import { mainApi } from "~/lib/redux/apis/main-api/main"
import { useAppSelector, useAppDispatch } from "~/lib/redux/hooks"
import { bookCartSlice } from "~/lib/redux/book-cart/bookCartSlice"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table"
import { dbQueryWithToast } from "~/components/toast/toasting"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"

export default function CartPage() {
    const dispatch = useAppDispatch()
    const cartContent = useAppSelector((state) => state.bookCart.value)
    const router = useRouter()
    const [triggerCheckout] = mainApi.useCheckoutMutation()

    const updateQuantity = (id: string, newQuantity: number) => {
        if (newQuantity < 1) return

        dispatch(bookCartSlice.actions.updateAmount({ id, amount: newQuantity }))
    }

    const removeItem = (id: string) => {
        dispatch(bookCartSlice.actions.removeAmount({ id, amount: 1 }))
    }

    const total = cartContent.reduce((sum, item) => sum + item.price * item.amount, 0)

    const handleCheckout = async () => {
        const products = cartContent.map((item) => ({
            stripeId: item.stripeId,
            quantity: item.amount,
        }))

        const stripeUrl = await dbQueryWithToast({
            dbQuery: () =>
                triggerCheckout({ data: { products } })
                    .then((result) => {
                        if (result.error) {
                            throw new Error(result.error as string)
                        }

                        if (!result.data.success) {
                            throw new Error(result.data.errorMessage)
                        }

                        return {
                            data: result.data.url,
                            success: true,
                            errorMessage: "",
                        }
                    })
                    .catch((error) => ({
                        data: undefined,
                        success: false,
                        errorMessage: (error as Error).message,
                    })),
            mutationName: "checkout",
            waitingMessage: "Finalizando compra...",
            successMessage: "Redirecionando para o Stripe...",
        })

        if (stripeUrl) {
            router.push(stripeUrl)
        }
    }

    return (
        <main className="flex-grow container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8">Shopping Cart</h1>

            {cartContent.length > 0 ? (
                <div className="flex flex-col lg:flex-row gap-8">
                    {/* Cart Items */}
                    <div className="lg:w-2/3">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[100px]">Product</TableHead>
                                    <TableHead>Details</TableHead>
                                    <TableHead>Quantity</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {cartContent.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            <Image
                                                src={item.mainImg}
                                                alt={`Cover of ${item.title}`}
                                                className="w-16 h-20 object-cover"
                                                width={100}
                                                height={100}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <h3 className="font-semibold">{item.title}</h3>
                                            <p className="text-sm text-muted-foreground">{item.author}</p>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center space-x-2">
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => updateQuantity(item.id, item.amount - 1)}
                                                >
                                                    <Minus className="h-4 w-4" />
                                                </Button>
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    value={item.amount}
                                                    onChange={(e) => updateQuantity(item.id, parseInt(e.target.value))}
                                                    className="w-16 text-center"
                                                />
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={() => updateQuantity(item.id, item.amount + 1)}
                                                >
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right">${(item.price * item.amount).toFixed(2)}</TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => removeItem(item.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Order Summary */}
                    <div className="lg:w-1/3">
                        <div className="bg-muted p-6 rounded-lg">
                            <h2 className="text-xl font-semibold mb-4">Order Summary</h2>
                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span>Subtotal</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between font-semibold text-lg">
                                    <span>Total</span>
                                    <span>${total.toFixed(2)}</span>
                                </div>
                            </div>
                            <Button
                                className="w-full mt-6"
                                type="button"
                                onClick={handleCheckout}
                            >
                                Proceed to Checkout
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="text-center">
                    <p className="text-xl mb-4">Your cart is empty</p>
                    <Button asChild>
                        <Link href="/books">Continue Shopping</Link>
                    </Button>
                </div>
            )}
        </main>
    )
}
