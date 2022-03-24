<template>
    <label class="message-holder">
        <p>{{message}}</p>
    </label>
</template>

<style scoped>
    label.message-holder > p {
        margin: 0.25em;
    }
    label.message-holder + label.message-holder {
        border-top: 1px solid black;
        border-top-width: 80%;
    }

    @media (max-width: 600px) {
        label.message-holder { 
            line-break: anywhere;
        }
    }
</style>

<script lang="ts">
import { defineComponent } from "@vue/runtime-core"


export default defineComponent({
    name: 'message-holder',
    model: {
        event: 'expired',
    },
    props: {
        message: {
            type: String, required: true
        }
    },
    mounted() {
      setTimeout(() => { this.$emit('expired', this.message) }, 10000)
    },
});
</script>